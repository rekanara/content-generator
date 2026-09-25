// AI planner: looks at the upcoming week's runs and creates slot_override plans
// SPARINGLY — exceptions with justification, never a full schedule (the state-based
// rotation stays the default; nothing pre-generates plans here beyond LLM proposals
// for individual dates). Triggers: daily cron (groups with auto_plan) + /plan (manual).
// One LLM call per invocation; proposals are validated against real ids before insert.
import { CronJob } from 'cron';
import { sql } from '../db/pool.ts';
import { chatJson, writerModel } from '../llm.ts';
import { isPlannerOut, type PlannerOut } from '../schema.ts';
import { plannerPrompt, type PlannerRun, type PlannerTemplate } from '../prompts.ts';
import { previewSlots } from '../state.ts';
import type { Platform } from '../state.ts';
import { nextFires, toJakartaDate, jakartaToday, TZ } from '../cronmath.ts';
import { getGroupCfg, listGroups, type GroupCfg } from '../groups.ts';
import { getRotationRow, getActivePillars } from '../repos/rotation.ts';
import { listPillars } from '../repos/pillars.ts';
import { listTemplates } from '../repos/templates.ts';
import { listPlans, createPlan } from '../repos/plans.ts';
import { recordLlmRun } from '../repos/llm-runs.ts';
import { sendMessage } from '../telegram.ts';
import type { Plan } from '@workspace/shared';

const MAX_PLANS = 3;

export type PlannerResult = {
  created: { plan: Plan; templateName: string; pillarName: string | null }[];
  skipped: string[];
};

// Run the planner for one group. Returns created plans + skip reasons (validation).
// Throws on infra/LLM failure — callers decide how to report.
export async function runPlanner(cfg: GroupCfg): Promise<PlannerResult> {
  // cron off = no dates mapping to runs — nothing to plan
  const [grp] = await sql<{ cron_expr: string; cron_enabled: boolean }[]>`select cron_expr, cron_enabled from groups where id = ${cfg.id}`;
  if (!grp?.cron_enabled) return { created: [], skipped: ['cron off — dates do not map to runs'] };

  const [rot, pillars, allPillars, templates, plans, recent, starred] = await Promise.all([
    getRotationRow(cfg.id),
    getActivePillars(cfg.id),
    listPillars(cfg.id),
    listTemplates(cfg.id, 200),
    listPlans(cfg.id, 200),
    sql<{ topic: string }[]>`select topic from posts where group_id = ${cfg.id}
      and status in ('sent','rendered','draft','awaiting_approval') order by created_at desc limit 30`,
    sql<{ topic: string }[]>`select topic from posts where group_id = ${cfg.id}
      and starred and status = 'sent' order by created_at desc limit 10`,
  ]);

  const slots = previewSlots(
    {
      last_platform: rot.last_platform as Platform,
      last_ig_format: rot.last_ig_format,
      last_li_format: rot.last_li_format,
      last_pillar_id: rot.last_pillar_id,
    },
    pillars,
    7,
  );
  const fires = nextFires(grp.cron_expr, new Date(), 7);
  const plannedDates = new Set(plans.filter((p) => p.status === 'active').map((p) => p.for_date));
  // ACTIVE pillars only — matches the offered set and the schema guard's contract
  // (an inactive pinned pillar would silently fall back at resolve time anyway).
  const activePillarById = new Map(pillars.map((p) => [p.id, p]));
  const pillarNameById = new Map(allPillars.map((p) => [p.id, p.name]));

  // candidate dates: future fire dates WITHOUT an active plan (today excluded —
  // a run may already be in flight)
  const today = jakartaToday();
  const runs: PlannerRun[] = [];
  const slotByDate = new Map<string, PlannerRun>();
  fires.forEach((f, i) => {
    const date = toJakartaDate(f);
    if (date <= today || plannedDates.has(date)) return;
    const s = slots[i];
    if (!s) return;
    const pillar = pillarNameById.has(s.pillar_id) ? allPillars.find((p) => p.id === s.pillar_id) : undefined;
    if (!pillar || !activePillarById.has(pillar.id)) return;
    const r: PlannerRun = {
      date,
      weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: TZ }).format(f),
      platform: s.platform,
      format: s.format,
      pillar: { id: pillar.id, name: pillar.name, description: pillar.description },
    };
    runs.push(r);
    slotByDate.set(date, r);
  });

  if (runs.length === 0) return { created: [], skipped: ['no unplanned future dates'] };

  const palette: PlannerTemplate[] = templates.map((t) => ({ id: t.id, name: t.name, type: t.type, format: t.format }));
  const model = writerModel(cfg);
  const out = await chatJson<PlannerOut>(
    cfg,
    model,
    plannerPrompt(runs, palette, recent.map((r) => r.topic), starred.map((r) => r.topic)),
    isPlannerOut,
    2000,
  );
  // usage + snapshot cost row (planner runs happen outside a post)
  await recordLlmRun(cfg.id, 'planner', model, out.usage.prompt, out.usage.completion).catch(() => {});

  // validate proposals against the offered data before inserting anything
  const validDates = new Set(runs.map((r) => r.date));
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const result: PlannerResult = { created: [], skipped: [] };
  const seenDates = new Set<string>();

  for (const p of out.data.plans) {
    if (result.created.length >= MAX_PLANS) { result.skipped.push(`${p.for_date}: cap ${MAX_PLANS} reached`); continue; }
    if (!validDates.has(p.for_date)) { result.skipped.push(`${p.for_date}: not an offered date`); continue; }
    if (seenDates.has(p.for_date)) { result.skipped.push(`${p.for_date}: duplicate`); continue; }
    const tpl = templateById.get(p.template_id);
    if (!tpl) { result.skipped.push(`${p.for_date}: unknown template`); continue; }
    const pillarId = p.pillar_id ?? null;
    if (pillarId && !activePillarById.has(pillarId)) { result.skipped.push(`${p.for_date}: unknown pillar`); continue; }
    // platform/format compatibility when overridden
    const platform = (p.platform ?? slotByDate.get(p.for_date)!.platform) as 'instagram' | 'linkedin';
    const format = (p.format ?? slotByDate.get(p.for_date)!.format) as string;
    const badCombo = (platform === 'instagram' && (format === 'pdf' || format === 'text')) ||
      (platform === 'linkedin' && (format === 'carousel' || format === 'reels'));
    if (badCombo) { result.skipped.push(`${p.for_date}: format ${format} invalid for ${platform}`); continue; }

    seenDates.add(p.for_date);
    try {
      const plan = await createPlan(cfg.id, {
        for_date: p.for_date, type: 'slot_override',
        platform: p.platform ?? null, format: p.format ?? null,
        pillar_id: pillarId, template_id: tpl.id,
        note: p.note.slice(0, 200),
      });
      result.created.push({
        plan,
        templateName: tpl.name,
        pillarName: pillarId ? (pillarNameById.get(pillarId) ?? null) : null,
      });
    } catch (e) {
      result.skipped.push(`${p.for_date}: ${(e as Error).message.slice(0, 80)}`);
    }
  }
  return result;
}

// Human-readable report (Telegram + logs).
export function formatPlannerReport(slug: string, r: PlannerResult): string {
  const lines = [`Planner — ${slug}`];
  if (r.created.length === 0) {
    lines.push('Tidak ada plan baru (tetap rotasi natural).');
  } else {
    for (const { plan, templateName, pillarName } of r.created) {
      lines.push(`· ${plan.for_date} → "${plan.note}" [${templateName}${pillarName ? ` · ${pillarName}` : ''}]`);
    }
    lines.push('', 'Kelola di dashboard (section Plans) — cancel kapan saja.');
  }
  for (const s of r.skipped.slice(0, 5)) lines.push(`(skip: ${s})`);
  return lines.join('\n');
}

/** Daily planner cron (17:00 Jakarta) for every group with auto_plan enabled. */
export function startPlanner(): void {
  new CronJob(
    '0 17 * * *',
    () => void runAutoPlanner().catch((e) => console.error(`[planner] cron failed: ${(e as Error).message}`)),
    null,
    true,
    TZ,
  );
  console.log('[planner] daily AI planner armed (17:00 WIB, groups with auto_plan)');
}

async function runAutoPlanner(): Promise<void> {
  const groups = (await listGroups()).filter((g) => g.auto_plan);
  for (const g of groups) {
    const cfg = await getGroupCfg(g.slug).catch(() => null);
    if (!cfg) continue;
    try {
      const r = await runPlanner(cfg);
      console.log(`[planner] ${g.slug}: ${r.created.length} plan(s) created`);
      if (r.created.length > 0) {
        await sendMessage(cfg, formatPlannerReport(g.slug, r)).catch(() => {});
      }
    } catch (e) {
      // low-stakes: log only — a failed planning day costs nothing (natural rotation runs)
      console.error(`[planner] ${g.slug} failed: ${(e as Error).message}`);
    }
  }
}

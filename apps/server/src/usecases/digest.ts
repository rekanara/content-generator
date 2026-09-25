// Daily digest: what the machine will do today + what waits for a human.
// 07:00 WIB per cron-enabled group — information pushed, not hunted.
// Content: today's slot spec (plan merge or natural rotation), tomorrow's slot,
// awaiting-approval queue, sent-yesterday recap + cost, idea backlog depth.
import { CronJob } from 'cron';
import { sql } from '../db/pool.ts';
import { sendMessage } from '../telegram.ts';
import { getGroupCfgById } from '../groups.ts';
import { listGroups } from '../groups.ts';
import { previewSlots } from '../state.ts';
import { getRotation, getActivePillars } from '../repos/rotation.ts';
import { listPillars } from '../repos/pillars.ts';
import { listPlans } from '../repos/plans.ts';
import { nextFires, toJakartaDate, jakartaToday, TZ } from '../cronmath.ts';
import type { Platform } from '../state.ts';

const FMT_LABEL: Record<string, string> = { carousel: 'IG carousel', reels: 'IG reels', pdf: 'LI pdf', text: 'LI text' };

async function digest(cfg: Awaited<ReturnType<typeof getGroupCfgById>>): Promise<string | null> {
  const [grp] = await sql<{ cron_expr: string; cron_enabled: boolean }[]>`select cron_expr, cron_enabled from groups where id = ${cfg.id}`;
  if (!grp?.cron_enabled) return null;

  const [rot, pillars, allPillars, plans] = await Promise.all([
    getRotation(cfg.id),
    getActivePillars(cfg.id),
    listPillars(cfg.id),
    listPlans(cfg.id, 200),
  ]);
  const slots = previewSlots(
    { last_platform: rot.last_platform as Platform, last_ig_format: rot.last_ig_format, last_li_format: rot.last_li_format, last_pillar_id: rot.last_pillar_id },
    pillars, 2,
  );
  const fires = nextFires(grp.cron_expr, new Date(), 2);
  const nameById = new Map(allPillars.map((p) => [p.id, p.name]));
  const planByDate = new Map(plans.filter((p) => p.status === 'active').map((p) => [p.for_date, p]));

  const lines: string[] = [`☀️ Digest — ${cfg.slug} · ${jakartaToday()}`];

  // today + tomorrow slot lines (plan pins override the natural spec)
  fires.slice(0, 2).forEach((f, i) => {
    const s = slots[i];
    if (!s) return;
    const date = toJakartaDate(f);
    const plan = planByDate.get(date);
    const fmt = plan?.format ?? s.format;
    const plat = plan?.platform ?? s.platform;
    const pillar = plan?.pillar_id ? (nameById.get(plan.pillar_id) ?? '?') : (nameById.get(s.pillar_id) ?? '?');
    lines.push(
      `${date === jakartaToday() ? 'Hari ini' : 'Besok'} ${f.toLocaleTimeString('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })} WIB → ${FMT_LABEL[fmt] ?? fmt} · ${pillar}${plan?.note ? ` (plan: ${plan.note.slice(0, 60)})` : ''}`,
    );
  });

  const [awaiting] = await sql<{ n: number }[]>`select count(*)::int as n from posts
    where group_id = ${cfg.id} and status = 'awaiting_approval'`;
  if ((awaiting?.n ?? 0) > 0) {
    lines.push('', `⚠️ ${awaiting!.n} post menunggu approval — cek chat/FE`);
  }

  // yesterday recap: posts + cost
  const [yPosts] = await sql<{ n: number }[]>`select count(*)::int as n from posts
    where group_id = ${cfg.id} and status = 'sent' and created_at >= (now() at time zone 'Asia/Jakarta')::date - interval '1 day'
      and created_at < (now() at time zone 'Asia/Jakarta')::date`;
  const [yCost] = await sql<{ c: number }[]>`select coalesce(sum((llm_usage->>'totalCost')::numeric), 0)::float as c from posts
    where group_id = ${cfg.id} and created_at >= (now() at time zone 'Asia/Jakarta')::date - interval '1 day'
      and created_at < (now() at time zone 'Asia/Jakarta')::date`;
  if ((yPosts?.n ?? 0) > 0) lines.push(`Kemarin: ${yPosts!.n} post terkirim · $${yCost!.c.toFixed(4)}`);

  const [ideas] = await sql<{ n: number }[]>`select count(*)::int as n from ideas
    where group_id = ${cfg.id} and used_at is null`;
  if ((ideas?.n ?? 0) > 0) lines.push(`💡 ${ideas!.n} idea di backlog — dipakai FIFO mulai run berikutnya`);

  return lines.length > 1 ? lines.join('\n') : null;
}

async function runDigest(): Promise<void> {
  const groups = await listGroups();
  for (const g of groups) {
    const cfg = await getGroupCfgById(g.id).catch(() => null);
    if (!cfg?.telegram.botToken || !cfg.telegram.chatId) continue;
    try {
      const text = await digest(cfg);
      if (text) await sendMessage(cfg, text);
    } catch (e) {
      console.error(`[digest] ${g.slug} failed: ${(e as Error).message}`);
    }
  }
}

/** Daily digest cron (07:00 Jakarta) — call once at daemon start. */
export function startDigest(): void {
  new CronJob(
    '0 7 * * *',
    () => void runDigest().catch((e) => console.error(`[digest] cron failed: ${(e as Error).message}`)),
    null,
    true,
    TZ,
  );
  console.log('[digest] daily digest armed (07:00 WIB)');
}

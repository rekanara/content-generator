// Calendar use case: next N runs — pure slot sequence + cron fire times + pillar names.
// Plans merge: an active plan owning a slot's date REPLACES the displayed spec
// (slot_override shows its pinned spec; override_content shows the override note).
// ponytail: in-flight runs are not reflected (rotation advances only after `sent`).
import type { CalendarRun } from '@workspace/shared';
import type { Platform } from '../state.ts';
import { previewSlots } from '../state.ts';
import { nextFires, toJakartaDate } from '../cronmath.ts';
import { getRotationRow, getActivePillars } from '../repos/rotation.ts';
import { listPillars } from '../repos/pillars.ts';
import { listPlans } from '../repos/plans.ts';
import { getTemplate } from '../repos/templates.ts';

export async function getCalendar(
  groupId: string,
  cronExpr: string,
  cronEnabled: boolean,
  n: number,
): Promise<CalendarRun[]> {
  const [rot, pillars, allPillars, plans] = await Promise.all([
    getRotationRow(groupId),
    getActivePillars(groupId),
    listPillars(groupId),
    listPlans(groupId, 200),
  ]);
  const names = new Map(allPillars.map((p) => [p.id, p.name]));
  const slots = previewSlots(
    {
      last_platform: rot.last_platform as Platform,
      last_ig_format: rot.last_ig_format,
      last_li_format: rot.last_li_format,
      last_pillar_id: rot.last_pillar_id,
    },
    pillars,
    n,
  );
  const fires = cronEnabled ? nextFires(cronExpr, new Date(), n) : [];

  // active plans by date — only one per date (DB-unique), so a plain Map is safe
  const planByDate = new Map(plans.filter((p) => p.status === 'active').map((p) => [p.for_date, p]));

  return Promise.all(slots.map(async (s, i) => {
    const fire = fires[i];
    const date = fire ? toJakartaDate(fire) : null;
    const plan = date ? planByDate.get(date) : undefined;
    if (!plan) {
      return {
        scheduled_at: fire?.toISOString() ?? null,
        platform: s.platform, format: s.format,
        pillar_id: s.pillar_id, pillar_name: names.get(s.pillar_id) ?? '—',
        planned: null,
      };
    }
    if (plan.type === 'override_content' && plan.override_id) {
      return {
        scheduled_at: fire?.toISOString() ?? null,
        platform: s.platform, format: s.format,
        pillar_id: s.pillar_id, pillar_name: names.get(s.pillar_id) ?? '—',
        planned: { type: 'override_content', note: plan.note || 'override content', platform: null, format: null, template_name: null },
      };
    }
    // slot_override — pinned spec wins the display; template name resolved when set
    const tpl = plan.template_id ? await getTemplate(groupId, plan.template_id) : null;
    return {
      scheduled_at: fire?.toISOString() ?? null,
      platform: plan.platform ?? s.platform,
      format: plan.format ?? s.format,
      pillar_id: plan.pillar_id ?? s.pillar_id,
      pillar_name: plan.pillar_id ? (names.get(plan.pillar_id) ?? '—') : (names.get(s.pillar_id) ?? '—'),
      planned: {
        type: 'slot_override',
        note: plan.note,
        platform: plan.platform ?? null,
        format: plan.format ?? null,
        template_name: tpl?.name ?? null,
      },
    };
  }));
}

// Calendar use case: next N runs — pure slot sequence + cron fire times + pillar names.
// ponytail: in-flight runs are not reflected (rotation advances only after `sent`).
import type { CalendarRun } from '@workspace/shared';
import type { Platform } from '../state.ts';
import { previewSlots } from '../state.ts';
import { nextFires } from '../cronmath.ts';
import { getRotationRow, getActivePillars } from '../repos/rotation.ts';
import { listPillars } from '../repos/pillars.ts';

export async function getCalendar(
  groupId: string,
  cronExpr: string,
  cronEnabled: boolean,
  n: number,
): Promise<CalendarRun[]> {
  const [rot, pillars, allPillars] = await Promise.all([
    getRotationRow(groupId),
    getActivePillars(groupId),
    listPillars(groupId),
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
  return slots.map((s, i) => ({
    scheduled_at: fires[i]?.toISOString() ?? null,
    platform: s.platform,
    format: s.format,
    pillar_id: s.pillar_id,
    pillar_name: names.get(s.pillar_id) ?? '—',
  }));
}

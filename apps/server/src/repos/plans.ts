// Plans repository (group-scoped): date-scoped source of truth for what runs on a day.
// slot_override = pinned pipeline spec; override_content = link to an override row.
// Plans are EXCEPTIONS — runGenerate falls back to natural rotation when absent.
import { sql } from '../db/pool.ts';
import type { Plan } from '@workspace/shared';

type PlanRow = {
  id: string; group_id: string; for_date: string | Date;
  type: 'slot_override' | 'override_content';
  platform: 'instagram' | 'linkedin' | null;
  format: string | null;
  pillar_id: string | null; template_id: string | null; override_id: string | null;
  note: string; status: 'active' | 'cancelled'; created_at: Date;
};

function toOut(r: PlanRow): Plan {
  return {
    id: r.id,
    for_date: typeof r.for_date === 'string' ? r.for_date : new Date(r.for_date).toISOString().slice(0, 10),
    type: r.type, platform: r.platform ?? null,
    format: (r.format as Plan['format']) ?? null,
    pillar_id: r.pillar_id ?? null, template_id: r.template_id ?? null,
    override_id: r.override_id ?? null,
    note: r.note, status: r.status,
    created_at: (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).toISOString(),
  };
}



export async function listPlans(groupId: string, limit = 100): Promise<Plan[]> {
  const rows = await sql<PlanRow[]>`select id, group_id, for_date, type, platform, format, pillar_id, template_id, override_id, note, status, created_at from plans
    where group_id = ${groupId} order by for_date desc, id desc limit ${limit}`;
  return rows.map(toOut);
}

export async function getPlan(groupId: string, id: string): Promise<Plan | null> {
  const [r] = await sql<PlanRow[]>`select id, group_id, for_date, type, platform, format, pillar_id, template_id, override_id, note, status, created_at from plans
    where id = ${id} and group_id = ${groupId}`;
  return r ? toOut(r) : null;
}

// The active plan owning a date (cancelled frees it) — runGenerate consults this first.
export async function getPlanByDate(groupId: string, forDate: string): Promise<Plan | null> {
  const [r] = await sql<PlanRow[]>`select id, group_id, for_date, type, platform, format, pillar_id, template_id, override_id, note, status, created_at from plans
    where group_id = ${groupId} and for_date = ${forDate} and status = 'active' limit 1`;
  return r ? toOut(r) : null;
}

export async function createPlan(groupId: string, d: {
  for_date: string; type: 'slot_override' | 'override_content';
  platform?: string | null; format?: string | null;
  pillar_id?: string | null; template_id?: string | null;
  override_id?: string | null; note?: string;
}): Promise<Plan> {
  const [r] = await sql<PlanRow[]>`insert into plans
    (group_id, for_date, type, platform, format, pillar_id, template_id, override_id, note)
    values (${groupId}, ${d.for_date}, ${d.type}, ${d.platform ?? null}, ${d.format ?? null},
      ${d.pillar_id ?? null}, ${d.template_id ?? null}, ${d.override_id ?? null}, ${d.note ?? ''})
    returning id, group_id, for_date, type, platform, format, pillar_id, template_id, override_id, note, status, created_at`;
  if (!r) throw new Error('insert plan failed');
  return toOut(r);
}

export async function cancelPlan(groupId: string, id: string): Promise<boolean> {
  const r = await sql`update plans set status = 'cancelled'
    where id = ${id} and group_id = ${groupId} and status = 'active' returning id`;
  return r.length > 0;
}

export async function deletePlan(groupId: string, id: string): Promise<boolean> {
  const r = await sql`delete from plans where id = ${id} and group_id = ${groupId} returning id`;
  return r.length > 0;
}

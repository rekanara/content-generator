// Override repository (group-scoped): manual content that replaces the pipeline
// for a specific date. One non-cancelled override per (group, date) — DB enforced.
import { sql } from '../db/pool.ts';
import type { Override, OverrideType } from '@workspace/shared';

type OverrideRow = {
  id: string; group_id: string; name: string; type: OverrideType;
  template_id: string | null; description: string; for_date: string;
  images: string[]; status: 'scheduled' | 'sent' | 'cancelled';
  created_at: Date;
};

function toOut(r: OverrideRow): Override {
  return {
    id: r.id, name: r.name, type: r.type,
    template_id: r.template_id ?? null,
    description: r.description,
    for_date: typeof r.for_date === 'string' ? r.for_date : new Date(r.for_date).toISOString().slice(0, 10),
    images: Array.isArray(r.images) ? r.images : [],
    status: r.status,
    created_at: (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).toISOString(),
  };
}

export async function listOverrides(groupId: string, limit = 100): Promise<Override[]> {
  const rows = await sql<OverrideRow[]>`select id, group_id, name, type, template_id, description, for_date, images, status, created_at
    from overrides where group_id = ${groupId} order by for_date desc, id desc limit ${limit}`;
  return rows.map(toOut);
}

// The override row by id — plan flow (plans.override_id) resolves through this.
export async function getOverride(groupId: string, id: string): Promise<Override | null> {
  const [r] = await sql<OverrideRow[]>`select id, group_id, name, type, template_id, description, for_date, images, status, created_at
    from overrides where id = ${id} and group_id = ${groupId}`;
  return r ? toOut(r) : null;
}

// Override + its plan row in ONE transaction — an override always owns its date's plan
// (type override_content). A conflicting active plan (slot_override) rolls back both.
export async function createOverrideWithPlan(groupId: string, d: {
  name: string; type: OverrideType; template_id: string | null;
  description: string; for_date: string; images: string[];
}): Promise<Override> {
  return sql.begin(async (tx) => {
    const [r] = await tx<OverrideRow[]>`insert into overrides (group_id, name, type, template_id, description, for_date, images)
      values (${groupId}, ${d.name}, ${d.type}, ${d.template_id}, ${d.description}, ${d.for_date}, ${JSON.stringify(d.images)}::jsonb)
      returning id, group_id, name, type, template_id, description, for_date, images, status, created_at`;
    if (!r) throw new Error('insert override failed');
    await tx`insert into plans (group_id, for_date, type, override_id, note)
      values (${groupId}, ${d.for_date}, 'override_content', ${r.id}, ${d.name})`;
    return toOut(r);
  });
}

export async function updateOverrideImages(id: string, images: string[]): Promise<void> {
  await sql`update overrides set images = ${JSON.stringify(images)}::jsonb where id = ${id}`;
}

// Description edit (polish-accept flow). Scheduled only — a sent override's
// text must keep matching what actually shipped.
export async function updateOverrideDescription(groupId: string, id: string, description: string): Promise<boolean> {
  const r = await sql`update overrides set description = ${description}
    where id = ${id} and group_id = ${groupId} and status = 'scheduled' returning id`;
  return r.length > 0;
}

export async function markOverrideSent(id: string): Promise<void> {
  await sql`update overrides set status = 'sent', sent_at = now() where id = ${id} and status = 'scheduled'`;
}

// Cancel the override AND its plan row (freeing the date) in one transaction —
// a cancelled override with an active plan would block re-creating either.
export async function cancelOverride(groupId: string, id: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const r = await tx`update overrides set status = 'cancelled'
      where id = ${id} and group_id = ${groupId} and status = 'scheduled' returning id`;
    if (r.length === 0) return false;
    await tx`update plans set status = 'cancelled' where override_id = ${id} and status = 'active'`;
    return true;
  });
}

export async function deleteOverride(groupId: string, id: string): Promise<boolean> {
  const r = await sql`delete from overrides where id = ${id} and group_id = ${groupId} returning id`;
  return r.length > 0;
}

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

export async function getOverride(groupId: string, id: string): Promise<Override | null> {
  const [r] = await sql<OverrideRow[]>`select id, group_id, name, type, template_id, description, for_date, images, status, created_at
    from overrides where id = ${id} and group_id = ${groupId}`;
  return r ? toOut(r) : null;
}

// The override (excluding cancelled) that owns the given date — runGenerate consults this:
// scheduled → deliver it; sent → skip generate; cancelled/none → normal generate.
export async function getOverrideByDate(groupId: string, forDate: string): Promise<Override | null> {
  const [r] = await sql<OverrideRow[]>`select id, group_id, name, type, template_id, description, for_date, images, status, created_at
    from overrides where group_id = ${groupId} and for_date = ${forDate} and status <> 'cancelled' limit 1`;
  return r ? toOut(r) : null;
}

export async function createOverride(groupId: string, d: {
  name: string; type: OverrideType; template_id: string | null;
  description: string; for_date: string; images: string[];
}): Promise<Override> {
  const [r] = await sql<OverrideRow[]>`insert into overrides (group_id, name, type, template_id, description, for_date, images)
    values (${groupId}, ${d.name}, ${d.type}, ${d.template_id}, ${d.description}, ${d.for_date}, ${JSON.stringify(d.images)}::jsonb)
    returning id, group_id, name, type, template_id, description, for_date, images, status, created_at`;
  if (!r) throw new Error('insert override failed');
  return toOut(r);
}

export async function updateOverrideImages(id: string, images: string[]): Promise<void> {
  await sql`update overrides set images = ${JSON.stringify(images)}::jsonb where id = ${id}`;
}

export async function markOverrideSent(id: string): Promise<void> {
  await sql`update overrides set status = 'sent', sent_at = now() where id = ${id} and status = 'scheduled'`;
}

export async function cancelOverride(groupId: string, id: string): Promise<boolean> {
  const r = await sql`update overrides set status = 'cancelled'
    where id = ${id} and group_id = ${groupId} and status = 'scheduled' returning id`;
  return r.length > 0;
}

export async function deleteOverride(groupId: string, id: string): Promise<boolean> {
  const r = await sql`delete from overrides where id = ${id} and group_id = ${groupId} returning id`;
  return r.length > 0;
}

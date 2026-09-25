// Pillar repository (group-scoped).
import { sql } from '../db/pool.ts';
import type { Pillar } from '@workspace/shared';

export async function listPillars(groupId: string): Promise<Pillar[]> {
  const rows = await sql`select id, name, description, is_news, active, sort_order
    from pillars where group_id = ${groupId} order by sort_order, id`;
  return rows.map((r) => ({
    id: r.id as string, name: r.name as string, description: r.description as string,
    is_news: r.is_news as boolean, active: r.active as boolean, sort_order: r.sort_order as number,
  }));
}

export async function createPillar(groupId: string, d: { name: string; description: string; is_news: boolean; sort_order: number }): Promise<void> {
  await sql`insert into pillars (group_id, name, description, is_news, sort_order)
    values (${groupId}, ${d.name}, ${d.description}, ${d.is_news}, ${d.sort_order})`;
}

export async function togglePillar(groupId: string, id: string): Promise<void> {
  await sql`update pillars set active = not active where id = ${id} and group_id = ${groupId}`;
}

export async function deletePillar(groupId: string, id: string): Promise<void> {
  await sql`delete from pillars where id = ${id} and group_id = ${groupId}`;
}

// Full-field update. Returns false when the (id, group) pair doesn't match → API 404.
export async function updatePillar(groupId: string, id: string, d: { name: string; description: string; is_news: boolean; sort_order: number }): Promise<boolean> {
  const r = await sql`update pillars set
    name = ${d.name}, description = ${d.description}, is_news = ${d.is_news}, sort_order = ${d.sort_order}
    where id = ${id} and group_id = ${groupId} returning id`;
  return r.length > 0;
}

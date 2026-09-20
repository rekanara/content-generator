// Style sample repository (group-scoped).
import { sql } from '../db/pool.ts';
import type { StyleSample } from '@workspace/shared';

export async function listStyles(groupId: string, limit = 50): Promise<StyleSample[]> {
  const rows = await sql`select id, title, body, platform, created_at
    from style_samples where group_id = ${groupId} order by id desc limit ${limit}`;
  return rows.map((s) => ({
    id: s.id as string, title: s.title as string, body: s.body as string,
    platform: (s.platform as string) ?? null, created_at: s.created_at as string,
  }));
}

export async function createStyle(groupId: string, d: { title: string; body: string; platform: string | null }): Promise<void> {
  await sql`insert into style_samples (group_id, title, body, platform)
    values (${groupId}, ${d.title}, ${d.body}, ${d.platform})`;
}

export async function deleteStyle(groupId: string, id: string): Promise<void> {
  await sql`delete from style_samples where id = ${id} and group_id = ${groupId}`;
}

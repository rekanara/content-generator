// Idea backlog repository (group-scoped). FIFO: oldest unused first.
// claimIdea does NOT mark used — the pipeline marks AFTER the draft persists, so a
// failed run re-attempts the same idea instead of silently dropping it.
import { sql } from '../db/pool.ts';
import type { Idea } from '@workspace/shared';

export async function listIdeas(groupId: string, limit = 50): Promise<Idea[]> {
  const rows = await sql`select id, text, source, used_at, created_at
    from ideas where group_id = ${groupId}
    order by used_at nulls first, created_at limit ${limit}`;
  return rows.map((r) => ({
    id: r.id as string, text: r.text as string, source: r.source as 'bot' | 'fe',
    used_at: (r.used_at as string | null) ?? null, created_at: r.created_at as string,
  }));
}

export async function addIdea(groupId: string, text: string, source: 'bot' | 'fe' = 'bot'): Promise<Idea> {
  const [r] = await sql`insert into ideas (group_id, text, source)
    values (${groupId}, ${text}, ${source})
    returning id, text, source, used_at, created_at`;
  return {
    id: r!.id as string, text: r!.text as string, source: r!.source as 'bot' | 'fe',
    used_at: null, created_at: r!.created_at as string,
  };
}

export async function deleteIdea(groupId: string, id: string): Promise<void> {
  await sql`delete from ideas where id = ${id} and group_id = ${groupId}`;
}

// Oldest unused idea for the group, unmarked. null = backlog empty.
export async function claimIdea(groupId: string): Promise<Idea | null> {
  const [r] = await sql`select id, text, source, created_at from ideas
    where group_id = ${groupId} and used_at is null
    order by created_at limit 1`;
  if (!r) return null;
  return { id: r.id as string, text: r.text as string, source: r.source as 'bot' | 'fe', used_at: null, created_at: r.created_at as string };
}

export async function markIdeaUsed(id: string): Promise<void> {
  await sql`update ideas set used_at = now() where id = ${id} and used_at is null`;
}

export async function countUnusedIdeas(groupId: string): Promise<number> {
  const [r] = await sql`select count(*)::int as n from ideas where group_id = ${groupId} and used_at is null`;
  return r?.n ?? 0;
}

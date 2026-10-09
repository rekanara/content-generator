import { sql } from '../db/pool.ts';
import type { Tutorial, TutorialInput } from '@workspace/shared';

export type TutorialSource = { url: string; title: string; text: string; fetched_at: string };

function toTutorial(r: any): Tutorial {
  return {
    id: r.id as string,
    topic: r.topic as string,
    level: r.level as Tutorial['level'],
    language: r.language as string,
    source_urls: r.source_urls as string[],
    status: r.status as Tutorial['status'],
    post_id: (r.post_id as string | null) ?? null,
    template_id: (r.template_id as string | null) ?? null,
    template_reel_id: (r.template_reel_id as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

export async function listTutorials(groupId: string): Promise<Tutorial[]> {
  const rows = await sql`select id, topic, level, language, source_urls, status, post_id, template_id, template_reel_id, error, created_at, updated_at
    from tutorials where group_id = ${groupId} order by created_at desc limit 100`;
  return rows.map(toTutorial);
}

export async function getTutorial(groupId: string, id: string): Promise<Tutorial | null> {
  const [r] = await sql`select id, topic, level, language, source_urls, status, post_id, template_id, template_reel_id, error, created_at, updated_at
    from tutorials where id = ${id} and group_id = ${groupId}`;
  return r ? toTutorial(r) : null;
}

export async function createTutorial(groupId: string, d: TutorialInput): Promise<Tutorial> {
  const [r] = await sql`insert into tutorials (group_id, topic, level, language, source_urls, template_id, template_reel_id)
    values (${groupId}, ${d.topic}, ${d.level}, ${d.language}, ${d.source_urls}, ${d.template_id}, ${d.template_reel_id})
    returning id, topic, level, language, source_urls, status, post_id, template_id, template_reel_id, error, created_at, updated_at`;
  return toTutorial(r);
}

export async function deleteTutorial(groupId: string, id: string): Promise<boolean> {
  const rows = await sql`delete from tutorials where id = ${id} and group_id = ${groupId} and status <> 'queued' returning id`;
  return rows.length > 0;
}

// Claim for a run: one in-flight run per tutorial (queued rows refuse a second enqueue).
export async function markTutorialQueued(groupId: string, id: string): Promise<Tutorial | null> {
  const [r] = await sql`update tutorials set status = 'queued', error = null, updated_at = now()
    where id = ${id} and group_id = ${groupId} and status <> 'queued'
    returning id, topic, level, language, source_urls, status, post_id, template_id, template_reel_id, error, created_at, updated_at`;
  return r ? toTutorial(r) : null;
}

export async function saveTutorialSnapshot(id: string, sources: TutorialSource[]): Promise<void> {
  await sql`update tutorials set source_snapshot = ${sql.json(sources as never)}, updated_at = now() where id = ${id}`;
}

export async function markTutorialGenerated(id: string, postId: string): Promise<void> {
  await sql`update tutorials set status = 'generated', post_id = ${postId}, error = null, updated_at = now() where id = ${id}`;
}

export async function markTutorialFailed(id: string, err: unknown): Promise<void> {
  const msg = String((err as Error)?.message ?? err).slice(0, 1000);
  await sql`update tutorials set status = 'failed', error = ${msg}, updated_at = now() where id = ${id}`;
}

// Boot: a queued tutorial whose run died with the daemon → failed (re-generate from the FE).
export async function failOrphanTutorials(): Promise<number> {
  const rows = await sql`update tutorials set status = 'failed', error = 'orphaned at boot', updated_at = now()
    where status = 'queued' returning id`;
  return rows.length;
}

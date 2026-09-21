// post_events audit trail: append-only log per post.
import { sql } from '../db/pool.ts';

export type PostEvent = 'generated' | 'rendered' | 'awaiting_approval' | 'approved' | 'sent' | 'failed' | 'resent' | 'rejected' | 'rerendered';

export async function addEvent(postId: string, groupId: string, event: PostEvent, error?: string): Promise<void> {
  await sql`insert into post_events (post_id, group_id, event, error)
    values (${postId}, ${groupId}, ${event}, ${error ?? null})`;
}

export async function listEvents(postId: string, groupId: string): Promise<
  { id: string; event: string; error: string | null; created_at: string }[]
> {
  return sql`select id, event, error, created_at from post_events
    where post_id = ${postId} and group_id = ${groupId} order by created_at desc limit 50`;
}

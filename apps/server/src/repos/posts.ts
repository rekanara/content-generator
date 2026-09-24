// Post repository (group-scoped) + body flattening for display.
// NOTE: summary columns inlined literally — postgres.js `sql('str')` is an Identifier, not a fragment.
import { sql } from '../db/pool.ts';
import type { PostSummary, PostDetail } from '@workspace/shared';

export async function listPosts(groupId: string, limit = 100): Promise<PostSummary[]> {
  const rows = await sql`select id, platform, format, topic, status, source, created_at, pillar_id, starred
    from posts where group_id = ${groupId} order by id desc limit ${limit}`;
  return rows.map(toSummary);
}

export async function getPost(groupId: string, id: string): Promise<PostDetail | null> {
  const [p] = await sql`select id, platform, format, topic, caption, body, status, error, source, created_at, pillar_id, starred
    from posts where id = ${id} and group_id = ${groupId}`;
  if (!p) return null;
  return {
    ...toSummary(p),
    caption: (p.caption as string) ?? '',
    error: (p.error as string) ?? null,
    body_text: flattenBody(JSON.parse(p.body ?? 'null')),
    artifacts: artifactNames(p.format as string, p.body),
  };
}

// Artifact file names per format (from the stored body — slide count lives there).
// Names only — the objects exist in MinIO once the post is rendered.
export function artifactNames(format: string, body: string | null): string[] {
  if (format === 'carousel') {
    const slides = (JSON.parse(body ?? 'null') as { slides?: unknown[] })?.slides?.length ?? 0;
    return Array.from({ length: slides }, (_, i) => `slide-${String(i + 1).padStart(2, '0')}.png`);
  }
  if (format === 'pdf') return ['carousel.pdf'];
  if (format === 'reels') return ['reel.mp4'];
  return [];
}

// Cast a raw posts row → PostSummary (shared by list + detail).
function toSummary(p: any): PostSummary {
  return {
    id: p.id as string, platform: p.platform as string, format: p.format as string,
    topic: p.topic as string, status: p.status as PostSummary['status'],
    source: p.source as string, created_at: (p.created_at as string) ?? new Date().toISOString(),
    pillar_id: (p.pillar_id as string) ?? null,
    starred: (p.starred as boolean) ?? false,
  };
}

// Reject an awaiting_approval post → terminal `rejected` state. Rotation is NOT consumed
// (same guarantee as failed — rotation only advances after `sent`).
export async function rejectPost(groupId: string, id: string): Promise<boolean> {
  const r = await sql`update posts set status = 'rejected'
    where id = ${id} and group_id = ${groupId} and status = 'awaiting_approval' returning id`;
  return r.length > 0;
}

// Toggle the star (quality signal: feeds planner context + marks style-sample
// candidates). Returns the new state, or null when the post doesn't exist.
export async function toggleStar(groupId: string, id: string): Promise<boolean | null> {
  const [r] = await sql`update posts set starred = not starred
    where id = ${id} and group_id = ${groupId} returning starred`;
  return r ? (r.starred as boolean) : null;
}

// Flatten stored JSON body (per format) into plain display text. Pure — unit-testable.
export function flattenBody(body: any): string {
  if (!body) return '';
  if (body.body) return body.body;
  if (body.slides) return body.slides
    .map((s: { headline: string; body: string }, i: number) => `${i + 1}. ${s.headline}\n${s.body}`)
    .join('\n\n');
  if (body.scenes) return body.scenes
    .map((s: { overlay_text: string; narration: string }, i: number) => `${i + 1}. [${s.overlay_text}] ${s.narration}`)
    .join('\n');
  return JSON.stringify(body);
}

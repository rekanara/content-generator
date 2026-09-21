// In-process FIFO, one active run. Cron, bot, FE → same enqueue.
// Job carries group slug — cfg resolved at run time (config edits don't wait for old jobs).
import { sql } from './db/pool.ts';
import { resolveSlot, generateDraft, markSent, markFailed } from './pipeline.ts';
import type { Slot, Platform, Format } from './state.ts';
import { renderAndSave } from './render/carousel.ts';
import { renderReelsAndSave } from './render/reels.ts';
import { sendMediaGroupPhoto, sendDocument, sendMessage, sendVideo } from './telegram.ts';
import type { CarouselOut, ReelsOut, TextOut } from './schema.ts';
import { getGroupCfg } from './groups.ts';
import { addEvent } from './repos/events.ts';

type Job =
  | { kind: 'generate'; slug: string; forced?: { platform: Platform; format?: Format }; notifyChat: boolean; source?: string }
  | { kind: 'resend'; slug: string; postId: string };

const jobs: Job[] = [];
let running = false;
let lastActivity = Date.now(); // liveness: any queue touch updates this

export function enqueue(job: Job): number {
  jobs.push(job);
  lastActivity = Date.now();
  void drain();
  return jobs.length;
}

export function queueStatus(): { running: boolean; pending: number } {
  return { running, pending: jobs.length };
}

// Liveness for /api/health: idle queue is fine, but stale activity + running=true = stuck run.
export function queueLiveness(): { running: boolean; pending: number; lastActivityMs: number } {
  return { running, pending: jobs.length, lastActivityMs: Date.now() - lastActivity };
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (jobs.length > 0) {
      const job = jobs.shift()!;
      lastActivity = Date.now();
      let cfg: Awaited<ReturnType<typeof getGroupCfg>> | null = null;
      try {
        cfg = await getGroupCfg(job.slug);
        if (job.kind === 'generate') await runGenerate(cfg, job.forced, job.notifyChat, job.source);
        else await runResend(cfg, job.postId);
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`[queue] job failed (${job.slug}): ${msg}`);
        try {
          // generate failures with a post row are evented in runGenerate; here only resend (id always known)
          if (job.kind === 'resend' && cfg) await addEvent(job.postId, cfg.id, 'failed', msg);
        } catch { /* event write must never break the queue */ }
      }
      lastActivity = Date.now();
    }
  } finally {
    running = false;
  }
}

// One full run: resolve slot → draft → render → send → markSent.
async function runGenerate(
  cfg: Awaited<ReturnType<typeof getGroupCfg>>,
  forced?: { platform: Platform; format?: Format },
  notifyChat = true,
  source = 'cli',
): Promise<void> {
  const slot = await resolveSlot(cfg.id, forced);
  console.log(`[queue] run ${cfg.slug}: ${slot.platform} ${slot.format} pillar=${slot.pillar_id} source=${source}`);
  const r = await generateDraft(cfg, slot, source);
  await addEvent(r.postId, cfg.id, 'generated');
  try {
    await deliver(cfg, r.postId, slot, notifyChat);
  } catch (e) {
    await markFailed(r.postId, e); // status → failed immediately, not just event
    await addEvent(r.postId, cfg.id, 'failed', (e as Error).message).catch(() => {});
    throw e;
  }
}

// Send a rendered post (used by runGenerate + resend).
async function deliver(
  cfg: Awaited<ReturnType<typeof getGroupCfg>>,
  postId: string,
  slot: Slot,
  notifyChat: boolean,
): Promise<void> {
  const [post] = await sql`select platform, format, topic, caption, artifact_prefix, body, status
    from posts where id = ${postId} and group_id = ${cfg.id}`;
  if (!post) throw new Error(`post ${postId} not found`);

  if (post.status !== 'rendered') {
    if (slot.format === 'text') {
      // text format: send body directly, no render needed
      if (notifyChat) await withRetry(() => sendMessage(cfg, `${post.caption}\n\n${(JSON.parse(post.body) as TextOut).body}`));
      await markSent(cfg.id, postId, slot);
      await addEvent(postId, cfg.id, 'sent');
      return;
    }
    // not rendered yet → render first per format
    if (slot.format === 'reels') {
      await renderReelsAndSave(postId, JSON.parse(post.body) as ReelsOut, cfg);
    } else {
      const draft = JSON.parse(post.body) as CarouselOut;
      await renderAndSave(postId, slot.platform, draft, cfg.slug, cfg.id);
    }
    await addEvent(postId, cfg.id, 'rendered');
  }

  const prefix = (post.artifact_prefix as string | null) ?? `posts/${postId}/`;
  if (post.format === 'carousel') {
    const keys: string[] = [];
    // slide count from body
    const slides = (JSON.parse(post.body) as CarouselOut).slides.length;
    for (let i = 1; i <= slides; i++) keys.push(`${prefix}slide-${String(i).padStart(2, '0')}.png`);
    if (notifyChat) await withRetry(() => sendMediaGroupPhoto(cfg, keys, post.caption || post.topic));
  } else if (post.format === 'pdf') {
    if (notifyChat) await withRetry(() => sendDocument(cfg, `${prefix}carousel.pdf`, `carousel-${postId}.pdf`, post.caption || post.topic));
  } else if (post.format === 'reels') {
    if (notifyChat) await withRetry(() => sendVideo(cfg, `${prefix}reel.mp4`, `reel-${postId}.mp4`, post.caption || post.topic));
  }
  await markSent(cfg.id, postId, slot);
  await addEvent(postId, cfg.id, 'sent');
  console.log(`[queue] post #${postId} delivered + rotation advanced (${cfg.slug})`);
}

// Telegram sends can flake (network/429) — retry 2x with 5s backoff before failing a delivered post.
async function withRetry(fn: () => Promise<void>, tries = 3, delayMs = 5000): Promise<void> {
  for (let i = 1; i <= tries; i++) {
    try {
      await fn();
      return;
    } catch (e) {
      if (i === tries) throw e;
      console.warn(`[queue] send attempt ${i}/${tries} failed — retry in ${delayMs}ms: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function runResend(cfg: Awaited<ReturnType<typeof getGroupCfg>>, postId: string): Promise<void> {
  const [post] = await sql`select platform, format, artifact_prefix, body, status, caption, topic
    from posts where id = ${postId} and group_id = ${cfg.id}`;
  if (!post) throw new Error(`post ${postId} not found`);
  if (post.status !== 'rendered' && post.status !== 'sent') {
    throw new Error(`post ${postId} status ${post.status} — cannot resend`);
  }
  const prefix = (post.artifact_prefix as string | null) ?? `posts/${postId}/`;
  if (post.format === 'carousel') {
    const slides = (JSON.parse(post.body) as CarouselOut).slides.length;
    const keys: string[] = [];
    for (let i = 1; i <= slides; i++) keys.push(`${prefix}slide-${String(i).padStart(2, '0')}.png`);
    await withRetry(() => sendMediaGroupPhoto(cfg, keys, post.caption || post.topic));
  } else if (post.format === 'pdf') {
    await withRetry(() => sendDocument(cfg, `${prefix}carousel.pdf`, `carousel-${postId}.pdf`, post.caption || post.topic));
  } else if (post.format === 'reels') {
    await withRetry(() => sendVideo(cfg, `${prefix}reel.mp4`, `reel-${postId}.mp4`, post.caption || post.topic));
  } else {
    await withRetry(() => sendMessage(cfg, JSON.parse(post.body).body));
  }
  await addEvent(postId, cfg.id, 'resent');
  console.log(`[queue] post #${postId} resent (${cfg.slug})`);
}

// Boot cleanup: orphan queued/draft/rendered at daemon start → failed (previous crash).
export async function bootCleanup(): Promise<void> {
  const r = await sql`update posts set status = 'failed', error = 'orphaned at boot'
    where status in ('queued','draft','rendered') returning id, group_id`;
  for (const row of r) {
    console.log(`[boot] post #${row.id} orphan → failed`);
    try {
      await addEvent(row.id, row.group_id, 'failed', 'orphaned at boot');
    } catch { /* event write must never break boot */ }
  }
}

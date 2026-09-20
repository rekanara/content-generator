// In-process FIFO, one active run. Cron, bot, FE → same enqueue.
// Job carries group slug — cfg resolved at run time (config edits don't wait for old jobs).
import { sql } from './db.ts';
import { resolveSlot, generateDraft, markSent, markFailed } from './pipeline.ts';
import type { Slot, Platform, Format } from './state.ts';
import { renderAndSave } from './render/carousel.ts';
import { renderReelsAndSave } from './render/reels.ts';
import { sendMediaGroupPhoto, sendDocument, sendMessage, sendVideo } from './telegram.ts';
import type { CarouselOut, ReelsOut, TextOut } from './schema.ts';
import { getGroupCfg } from './groups.ts';

type Job =
  | { kind: 'generate'; slug: string; forced?: { platform: Platform; format?: Format }; notifyChat: boolean; source?: string }
  | { kind: 'resend'; slug: string; postId: string };

const jobs: Job[] = [];
let running = false;

export function enqueue(job: Job): number {
  jobs.push(job);
  void drain();
  return jobs.length;
}

export function queueStatus(): { running: boolean; pending: number } {
  return { running, pending: jobs.length };
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (jobs.length > 0) {
      const job = jobs.shift()!;
      try {
        const cfg = await getGroupCfg(job.slug);
        if (job.kind === 'generate') await runGenerate(cfg, job.forced, job.notifyChat, job.source);
        else await runResend(cfg, job.postId);
      } catch (e) {
        console.error(`[queue] job failed (${job.slug}): ${(e as Error).message}`);
      }
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
  await deliver(cfg, r.postId, slot, notifyChat);
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
      if (notifyChat) await sendMessage(cfg, `${post.caption}\n\n${(JSON.parse(post.body) as TextOut).body}`);
      await markSent(cfg.id, postId, slot);
      return;
    }
    // not rendered yet → render first per format
    if (slot.format === 'reels') {
      await renderReelsAndSave(postId, JSON.parse(post.body) as ReelsOut, cfg);
    } else {
      const draft = JSON.parse(post.body) as CarouselOut;
      await renderAndSave(postId, slot.platform, draft, cfg.slug, cfg.id);
    }
  }

  const prefix = (post.artifact_prefix as string | null) ?? `posts/${postId}/`;
  if (post.format === 'carousel') {
    const keys: string[] = [];
    // slide count from body
    const slides = (JSON.parse(post.body) as CarouselOut).slides.length;
    for (let i = 1; i <= slides; i++) keys.push(`${prefix}slide-${String(i).padStart(2, '0')}.png`);
    if (notifyChat) await sendMediaGroupPhoto(cfg, keys, post.caption || post.topic);
  } else if (post.format === 'pdf') {
    if (notifyChat) await sendDocument(cfg, `${prefix}carousel.pdf`, `carousel-${postId}.pdf`, post.caption || post.topic);
  } else if (post.format === 'reels') {
    if (notifyChat) await sendVideo(cfg, `${prefix}reel.mp4`, `reel-${postId}.mp4`, post.caption || post.topic);
  }
  await markSent(cfg.id, postId, slot);
  console.log(`[queue] post #${postId} delivered + rotation advanced (${cfg.slug})`);
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
    await sendMediaGroupPhoto(cfg, keys, post.caption || post.topic);
  } else if (post.format === 'pdf') {
    await sendDocument(cfg, `${prefix}carousel.pdf`, `carousel-${postId}.pdf`, post.caption || post.topic);
  } else if (post.format === 'reels') {
    await sendVideo(cfg, `${prefix}reel.mp4`, `reel-${postId}.mp4`, post.caption || post.topic);
  } else {
    await sendMessage(cfg, JSON.parse(post.body).body);
  }
  console.log(`[queue] post #${postId} resent (${cfg.slug})`);
}

// Boot cleanup: orphan queued/draft/rendered at daemon start → failed (previous crash).
export async function bootCleanup(): Promise<void> {
  const r = await sql`update posts set status = 'failed', error = 'orphaned at boot'
    where status in ('queued','draft','rendered') returning id`;
  for (const row of r) console.log(`[boot] post #${row.id} orphan → failed`);
}

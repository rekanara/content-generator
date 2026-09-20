// FIFO in-process, satu run aktif. Cron, bot, FE → enqueue yang sama.
import { sql } from './db.ts';
import { resolveSlot, generateDraft, markSent, markFailed } from './pipeline.ts';
import type { Slot, Platform, Format } from './state.ts';
import { renderAndSave } from './render/carousel.ts';
import { renderReelsAndSave } from './render/reels.ts';
import { sendMediaGroupPhoto, sendDocument, sendMessage, sendVideo } from './telegram.ts';
import type { CarouselOut, ReelsOut, TextOut } from './schema.ts';

type Job =
  | { kind: 'generate'; forced?: { platform: Platform; format?: Format }; notifyChat: boolean; source?: string }
  | { kind: 'resend'; postId: number };

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
        if (job.kind === 'generate') await runGenerate(job.forced, job.notifyChat, job.source);
        else await runResend(job.postId);
      } catch (e) {
        console.error(`[queue] job gagal: ${(e as Error).message}`);
      }
    }
  } finally {
    running = false;
  }
}

// Satu run penuh: resolve slot → draft → render → kirim → markSent.
async function runGenerate(
  forced?: { platform: Platform; format?: Format },
  notifyChat = true,
  source = 'cli',
): Promise<void> {
  const slot = await resolveSlot(forced);
  console.log(`[queue] run: ${slot.platform} ${slot.format} pillar=${slot.pillar_id} source=${source}`);
  const r = await generateDraft(slot, source);
  await deliver(r.postId, slot, notifyChat);
}

// Kirim post yang sudah dirender (dipakai runGenerate + resend).
async function deliver(postId: number, slot: Slot, notifyChat: boolean): Promise<void> {
  const [post] = await sql`select platform, format, topic, caption, artifact_prefix, body, status
    from posts where id = ${postId}`;
  if (!post) throw new Error(`post ${postId} tidak ada`);

  if (post.status !== 'rendered') {
    if (slot.format === 'text') {
      // format text: langsung kirim body, tak perlu render
      await sendMessage(`${post.caption}\n\n${(JSON.parse(post.body) as TextOut).body}`);
      await markSent(postId, slot);
      return;
    }
    // belum dirender → render dulu per format
    if (slot.format === 'reels') {
      await renderReelsAndSave(postId, JSON.parse(post.body) as ReelsOut);
    } else {
      const draft = JSON.parse(post.body) as CarouselOut;
      await renderAndSave(postId, slot.platform, draft);
    }
  }

  const prefix = (post.artifact_prefix as string | null) ?? `posts/${postId}/`;
  if (post.format === 'carousel') {
    const keys: string[] = [];
    // slide count dari body
    const slides = (JSON.parse(post.body) as CarouselOut).slides.length;
    for (let i = 1; i <= slides; i++) keys.push(`${prefix}slide-${String(i).padStart(2, '0')}.png`);
    if (notifyChat) await sendMediaGroupPhoto(keys, post.caption || post.topic);
  } else if (post.format === 'pdf') {
    if (notifyChat) await sendDocument(`${prefix}carousel.pdf`, `carousel-${postId}.pdf`, post.caption || post.topic);
  } else if (post.format === 'reels') {
    if (notifyChat) await sendVideo(`${prefix}reel.mp4`, `reel-${postId}.mp4`, post.caption || post.topic);
  }
  await markSent(postId, slot);
  console.log(`[queue] post #${postId} delivered + rotasi maju`);
}

async function runResend(postId: number): Promise<void> {
  const [post] = await sql`select platform, format, artifact_prefix, body, status, caption, topic
    from posts where id = ${postId}`;
  if (!post) throw new Error(`post ${postId} tidak ada`);
  if (post.status !== 'rendered' && post.status !== 'sent') {
    throw new Error(`post ${postId} status ${post.status} — tidak bisa resend`);
  }
  const prefix = (post.artifact_prefix as string | null) ?? `posts/${postId}/`;
  if (post.format === 'carousel') {
    const slides = (JSON.parse(post.body) as CarouselOut).slides.length;
    const keys: string[] = [];
    for (let i = 1; i <= slides; i++) keys.push(`${prefix}slide-${String(i).padStart(2, '0')}.png`);
    await sendMediaGroupPhoto(keys, post.caption || post.topic);
  } else if (post.format === 'pdf') {
    await sendDocument(`${prefix}carousel.pdf`, `carousel-${postId}.pdf`, post.caption || post.topic);
  } else if (post.format === 'reels') {
    await sendVideo(`${prefix}reel.mp4`, `reel-${postId}.mp4`, post.caption || post.topic);
  } else {
    await sendMessage(JSON.parse(post.body).body);
  }
  console.log(`[queue] post #${postId} resent`);
}

// Boot cleanup: orphan queued/draft/rendered saat daemon start → failed (crash sebelumnya).
export async function bootCleanup(): Promise<void> {
  const r = await sql`update posts set status = 'failed', error = 'orphan saat boot'
    where status in ('queued','draft','rendered') returning id`;
  for (const row of r) console.log(`[boot] post #${row.id} orphan → failed`);
}

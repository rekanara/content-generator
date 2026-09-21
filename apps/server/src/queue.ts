// In-process FIFO, one active run. Cron, bot, FE → same enqueue.
// Job carries group slug — cfg resolved at run time (config edits don't wait for old jobs).
import { sql } from './db/pool.ts';
import { resolveSlot, generateDraft, markSent, markFailed } from './pipeline.ts';
import type { Slot, Platform, Format } from './state.ts';
import { renderAndSave } from './render/carousel.ts';
import { renderReelsAndSave } from './render/reels.ts';
import { sendMediaGroupPhoto, sendDocument, sendMessage, sendVideo, sendMessageWithButtons } from './telegram.ts';
import type { CarouselOut, ReelsOut, TextOut } from './schema.ts';
import { getGroupCfg, getGroupCfgById } from './groups.ts';
import { addEvent } from './repos/events.ts';

type Job =
  | { kind: 'generate'; slug: string; forced?: { platform: Platform; format?: Format }; notifyChat: boolean; source?: string }
  | { kind: 'resend'; slug: string; postId: string }
  | { kind: 'approve'; slug: string; postId: string }
  | { kind: 'rerender'; slug: string; postId: string };

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
        else if (job.kind === 'approve') await runApprove(cfg, job.postId);
        else if (job.kind === 'rerender') await runRerender(cfg, job.postId);
        else await runResend(cfg, job.postId);
  } catch (e) {
    const msg = (e as Error).message;
    console.error(`[queue] job failed (${job.slug}): ${msg}`);
    try {
      // generate failures with a post row are evented in runGenerate; here only resend/approve/rerender (id always known)
      if (cfg && job.kind !== 'generate') await addEvent(job.postId, cfg.id, 'failed', msg);
    } catch { /* event write must never break the queue */ }
  }
      lastActivity = Date.now();
    }
  } finally {
    running = false;
  }
}

// One full run: resolve slot → draft → render → send → markSent.
// Approval gate (group flag): render → status awaiting_approval → Telegram approve/reject
// buttons → stop. Rotation NOT consumed until approved & sent (spec #11 holds).
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
    if (cfg.approval_required) await prepareForApproval(cfg, r.postId, slot);
    else await deliver(cfg, r.postId, slot, notifyChat);
  } catch (e) {
    await markFailed(r.postId, e); // status → failed immediately, not just event
    await addEvent(r.postId, cfg.id, 'failed', (e as Error).message).catch(() => {});
    await notifyRunFailed(cfg, e); // silent failures are the daemon's #1 operational risk
    throw e;
  }
}

// Render (if needed) + park the post at awaiting_approval + request approval in Telegram.
// Render happens BEFORE approval so approve→deliver is instant (no CPU wait on the button tap).
// ponytail: pre-render approval if rejected-runs waste too much CPU.
async function prepareForApproval(
  cfg: Awaited<ReturnType<typeof getGroupCfg>>,
  postId: string,
  slot: Slot,
): Promise<void> {
  const [post] = await sql<{ topic: string; platform: string; format: string; caption: string | null; body: string; status: string }[]>`select platform, format, topic, caption, body, status, artifact_prefix
    from posts where id = ${postId} and group_id = ${cfg.id}`;
  if (!post) throw new Error(`post ${postId} not found`);
  if (post.format !== 'text' && post.status !== 'rendered') {
    if (slot.format === 'reels') {
      await renderReelsAndSave(postId, JSON.parse(post.body) as ReelsOut, cfg);
    } else {
      await renderAndSave(postId, slot.platform, JSON.parse(post.body) as CarouselOut, cfg);
    }
    await addEvent(postId, cfg.id, 'rendered');
  }
  const upd = await sql`update posts set status = 'awaiting_approval'
    where id = ${postId} and group_id = ${cfg.id} and status in ('draft','rendered','queued') returning id`;
  if (upd.length === 0) throw new Error(`post ${postId} not in a pre-approval state`);
  await addEvent(postId, cfg.id, 'awaiting_approval');
  console.log(`[queue] post #${postId} awaiting approval (${cfg.slug})`);
  // Approval request is best-effort: if Telegram flakes, the post stays awaiting — FE can approve.
  // ponytail: inline buttons only work for the env (polled) bot — groups with a token override
  // get the message from their own bot whose callbacks we never receive; FE approve covers them.
  // (multi-bot polling = one getUpdates loop per token, when it ever matters)
  try {
    await withRetry(() => sendMessageWithButtons(cfg, approvalText(cfg.slug, post), [
      [
        { text: 'Approve — send now', callback_data: `approve:${postId}` },
        { text: 'Reject', callback_data: `reject:${postId}` },
      ],
    ]));
  } catch (e) {
    console.warn(`[queue] approval request failed (${cfg.slug}): ${(e as Error).message}`);
    await addEvent(postId, cfg.id, 'failed', `approval request not delivered: ${(e as Error).message}`).catch(() => {});
  }
}

function approvalText(slug: string, post: { topic: string; platform: string; format: string; caption: string | null }): string {
  return [
    `Approval needed — ${slug}`,
    `Topic: ${post.topic}`,
    `${post.platform}/${post.format} · slot rotation unchanged until sent`,
    '',
    `Caption: ${post.caption ? post.caption.slice(0, 900) : '—'}`,
  ].join('\n');
}

// Approve an awaiting_approval post: send now + advance rotation. On send failure the post
// STAYS awaiting_approval (tap approve again) — no markFailed, no rotation consumption.
async function runApprove(cfg: Awaited<ReturnType<typeof getGroupCfg>>, postId: string): Promise<void> {
  const [post] = await sql<{ platform: Platform; format: Format; pillar_id: string; status: string }[]>`select platform, format, pillar_id, status
    from posts where id = ${postId} and group_id = ${cfg.id}`;
  if (!post) throw new Error(`post ${postId} not found`);
  if (post.status !== 'awaiting_approval') {
    throw new Error(`post ${postId} status ${post.status} — cannot approve`);
  }
  const slot: Slot = { platform: post.platform, format: post.format, pillar_id: post.pillar_id };
  await addEvent(postId, cfg.id, 'approved');
  await deliver(cfg, postId, slot, true);
}

// Re-render an EXISTING post's body with the CURRENT template (content unchanged —
// for "template edited after send"). Routing by the post's pre-rerender status:
//   awaiting_approval → back to awaiting + fresh approval buttons (rotation still pending)
//   rendered          → gate ? awaiting + buttons : deliver (first send → rotation advances)
//   sent              → resend the new artifacts directly (rotation already consumed — untouched)
// failed/rejected/draft/queued → refused (/gen is the right tool for those).
async function runRerender(cfg: Awaited<ReturnType<typeof getGroupCfg>>, postId: string): Promise<void> {
  const [post] = await sql<{ platform: Platform; format: Format; pillar_id: string; status: string; topic: string; caption: string | null; body: string }[]>`select platform, format, pillar_id, status, topic, caption, body
    from posts where id = ${postId} and group_id = ${cfg.id}`;
  if (!post) throw new Error(`post ${postId} not found`);
  const wasStatus = post.status;
  if (!['sent', 'awaiting_approval', 'rendered'].includes(wasStatus)) {
    throw new Error(`post status ${wasStatus} — /rerender only works on sent/awaiting/rendered; use /gen for ${wasStatus}`);
  }
  if (post.format === 'text') throw new Error('text format has no visual template — nothing to re-render');

  console.log(`[queue] rerender #${postId} (${cfg.slug}, was ${wasStatus}) with current template`);
  if (post.format === 'reels') {
    await renderReelsAndSave(postId, JSON.parse(post.body) as ReelsOut, cfg);
  } else {
    await renderAndSave(postId, post.platform, JSON.parse(post.body) as CarouselOut, cfg);
  }
  await addEvent(postId, cfg.id, 'rerendered');

  if (wasStatus === 'sent') {
    // already delivered once → rotation was consumed → just ship the new artifacts.
    // restore status FIRST (guarded: render*AndSave just set 'rendered'): leaving it there
    // would let boot cleanup orphan-fail a genuinely-delivered post.
    await sql`update posts set status = 'sent' where id = ${postId} and group_id = ${cfg.id} and status = 'rendered'`;
    await runResend(cfg, postId);
    return;
  }
  if (wasStatus === 'rendered' && !cfg.approval_required) {
    // never sent, gate off → normal first delivery (send + rotation advance)
    const slot: Slot = { platform: post.platform, format: post.format, pillar_id: post.pillar_id };
    await deliver(cfg, postId, slot, true);
    return;
  }
  // awaiting_approval (or rendered with gate on) → park at awaiting + fresh approval message.
  // render*AndSave set status='rendered' — restore the deliberate pause (guarded: only from 'rendered',
  // so a concurrent reject can never be clobbered — rejectPost itself guards on 'awaiting_approval').
  await sql`update posts set status = 'awaiting_approval'
    where id = ${postId} and group_id = ${cfg.id} and status = 'rendered'`;
  await addEvent(postId, cfg.id, 'awaiting_approval');
  try {
    await withRetry(() => sendMessageWithButtons(cfg, [
      `Re-rendered with current template — ${cfg.slug}`,
      `Topic: ${post.topic}`,
      `${post.platform}/${post.format} · was ${wasStatus}`,
      '',
      `Caption: ${post.caption ? post.caption.slice(0, 900) : '—'}`,
    ].join('\n'), [
      [
        { text: 'Approve — send now', callback_data: `approve:${postId}` },
        { text: 'Reject', callback_data: `reject:${postId}` },
      ],
    ]));
  } catch (e) {
    console.warn(`[queue] rerender approval request failed (${cfg.slug}): ${(e as Error).message}`);
  }
  console.log(`[queue] post #${postId} re-rendered, awaiting approval (${cfg.slug})`);
}

// Send a post (used by runGenerate, runApprove, resend-style flows).
// awaiting_approval counts as artifact-ready (approve path) — no re-render.
async function deliver(
  cfg: Awaited<ReturnType<typeof getGroupCfg>>,
  postId: string,
  slot: Slot,
  notifyChat: boolean,
): Promise<void> {
  const [post] = await sql`select platform, format, topic, caption, artifact_prefix, body, status
    from posts where id = ${postId} and group_id = ${cfg.id}`;
  if (!post) throw new Error(`post ${postId} not found`);

  const ready = post.status === 'rendered' || post.status === 'awaiting_approval';
  if (!ready && slot.format !== 'text') {
    // not rendered yet → render first per format
    if (slot.format === 'reels') {
      await renderReelsAndSave(postId, JSON.parse(post.body) as ReelsOut, cfg);
    } else {
      const draft = JSON.parse(post.body) as CarouselOut;
      await renderAndSave(postId, slot.platform, draft, cfg);
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
  } else {
    // text format: send body directly, no artifacts
    if (notifyChat) await withRetry(() => sendMessage(cfg, `${post.caption}\n\n${(JSON.parse(post.body) as TextOut).body}`));
  }
  await markSent(cfg.id, postId, slot);
  await addEvent(postId, cfg.id, 'sent');
  // ponytail: telegram send happens BEFORE the DB commit — send-ok + commit-fail = duplicate
  // send on re-tap. Outbox/idempotency keys if it ever bites in practice.
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

// Best-effort run-failure alert to the group's Telegram chat. Never throws.
async function notifyRunFailed(cfg: Awaited<ReturnType<typeof getGroupCfg>>, e: unknown): Promise<void> {
  const msg = String((e as Error)?.message ?? e).slice(0, 300);
  try {
    await sendMessage(cfg, `Run failed — ${cfg.slug}: ${msg}\nThe slot's rotation was NOT consumed. Regenerate: /gen ${cfg.slug}`);
  } catch (te) {
    console.warn(`[queue] failure alert not delivered (${cfg.slug}): ${(te as Error).message}`);
  }
}

// Boot cleanup: orphan queued/draft/rendered at daemon start → failed (previous crash).
// awaiting_approval is a DELIBERATE pause — survives restarts, never boot-failed.
export async function bootCleanup(): Promise<void> {
  const r = await sql`update posts set status = 'failed', error = 'orphaned at boot'
    where status in ('queued','draft','rendered') returning id, group_id`;
  for (const row of r) {
    console.log(`[boot] post #${row.id} orphan → failed`);
    try {
      await addEvent(row.id, row.group_id, 'failed', 'orphaned at boot');
    } catch { /* event write must never break boot */ }
  }
  // one best-effort alert per affected group — crashed runs shouldn't be silent either
  const byGroup = new Map<string, number>();
  for (const row of r) byGroup.set(row.group_id, (byGroup.get(row.group_id) ?? 0) + 1);
  for (const [groupId, n] of byGroup) {
    const cfg = await getGroupCfgById(groupId).catch(() => null);
    if (!cfg) continue;
    try {
      await sendMessage(cfg, `Daemon restarted — ${n} in-flight post${n > 1 ? 's' : ''} marked failed (${cfg.slug}). Regenerate: /gen ${cfg.slug}`);
    } catch { /* alert is best-effort */ }
  }
}

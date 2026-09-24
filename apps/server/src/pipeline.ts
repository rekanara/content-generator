// Orchestrates one run: slot → ideation → writer → critic → (render/send called from outside).
// All queries group-scoped; LLM uses GroupCfg (group ?? env).
import { sql } from './db/pool.ts';
import { getRotation, getActivePillars, commitSent } from './repos/rotation.ts';
import { claimIdea, markIdeaUsed } from './repos/ideas.ts';
import { nextSlot, forcedSlot, plannedSlot, nextState, type Slot, type Platform, type Format } from './state.ts';
import { chatJson, writerModel, criticModel } from './llm.ts';
import { isIdeationOut, writerGuard, writerGuardName, assembleCaption, toCaptionOut, criticScore, stripCriticMeta, criticFeedback, type CaptionOut } from './schema.ts';
import { stepUsage, postUsage, type StepUsage } from './llm-costs.ts';
import { ideationPrompt, writerPrompt, criticPrompt } from './prompts.ts';
import type { StyleSample, PillarFull } from './prompts.ts';
import type { CarouselOut, ReelsOut, TextOut } from './schema.ts';
import type { GroupCfg } from './groups.ts';

export type Draft = CarouselOut | ReelsOut | TextOut;
export type RunResult = { postId: string; slot: Slot; topic: string; draft: Draft };

// Critic quality gate: a scored revision below this triggers ONE writer retry
// (with the critique as feedback). 7 = "solid publish" per the critic contract.
const CRITIC_THRESHOLD = 7;

// Per-step usage with the model + snapshot cost (llm-costs catalog) — stored in posts.llm_usage.
type UsageAcc = Record<string, StepUsage>;
const addUsage = (acc: UsageAcc, step: string, model: string, u: { prompt: number; completion: number }) => {
  const prev = acc[step];
  const prompt = (prev?.prompt ?? 0) + u.prompt;
  const completion = (prev?.completion ?? 0) + u.completion;
  acc[step] = stepUsage(model, prompt, completion);
};

async function getStyleSamples(platform: Platform, groupId: string): Promise<StyleSample[]> {
  return sql`select title, body, platform from style_samples
    where group_id = ${groupId} and (platform is null or platform = ${platform})
    order by created_at desc limit 8`;
}

async function getHistory(pillarId: string): Promise<string[]> {
  const rows = await sql`select topic from posts
    where pillar_id = ${pillarId} and status in ('sent','rendered','draft')
    order by created_at desc limit 30`;
  return rows.map((r: any) => r.topic);
}

// Recent topics across ALL pillars (same audience sees everything) — fed to ideation
// so "git bisect" (Tips) doesn't land right after "git blame" (Drama) as a repeat.
async function getRecentTopics(groupId: string): Promise<string[]> {
  const rows = await sql`select topic from posts
    where group_id = ${groupId} and status in ('sent','rendered','draft','awaiting_approval')
      and created_at > now() - interval '7 days'
    order by created_at desc limit 20`;
  return rows.map((r: any) => r.topic);
}

async function getPillar(id: string): Promise<PillarFull> {
  const r = (await sql`select id, name, description, is_news from pillars where id = ${id}`)[0] as any;
  if (!r) throw new Error(`pillar ${id} not found`);
  return r;
}

// RSS context: null → skip (non-news pillar OR feed failure → non-news fallback).
// Implemented in rss.ts (feeds_cache + freshness filter).
export { getNewsContext } from './rss.ts';
import { getNewsContext } from './rss.ts';

export async function resolveSlot(
  groupId: string,
  forced?: { platform: Platform; format?: Format },
): Promise<Slot> {
  const [state, pillars] = await Promise.all([getRotation(groupId), getActivePillars(groupId)]);
  if (forced) return forcedSlot(state, pillars, true, forced.platform, forced.format);
  return nextSlot(state, pillars, true);
}

// Slot from a plans slot_override row — every spec field falls back to natural
// rotation when null (pinned pillar must still be active, else natural pillar).
export async function resolvePlannedSlot(
  groupId: string,
  spec: { platform?: Platform | null; format?: Format | null; pillar_id?: string | null },
): Promise<Slot> {
  const [state, pillars] = await Promise.all([getRotation(groupId), getActivePillars(groupId)]);
  return plannedSlot(state, pillars, spec);
}

// Full LLM phase: ideation → writer → critic. No render, no send.
export async function generateDraft(cfg: GroupCfg, slot: Slot, source = 'cli'): Promise<RunResult> {
  const groupId = cfg.id;
  const pillar = await getPillar(slot.pillar_id);
  const usage: UsageAcc = {};

  // slot picked a news pillar but RSS isn't available → find the nearest non-news pillar
  let effPillar = pillar;
  if (pillar.is_news) {
    const news = await getNewsContext();
    if (!news) {
      const nonNews = (await sql`select id, name, description, is_news from pillars
        where group_id = ${groupId} and active and not is_news order by id limit 1`)[0] as any;
      if (!nonNews) throw new Error('news pillar without RSS and no non-news pillar available');
      console.log(`[pipeline] news pillar without RSS → fallback: ${nonNews.name}`);
      effPillar = nonNews;
      slot = { ...slot, pillar_id: nonNews.id };
    }
    var newsCtx: string | null = news;
  } else {
    var newsCtx: string | null = null;
  }

  // 1. topic source: idea backlog (FIFO, human-submitted) → else ideation LLM.
  //    An idea row carries the topic itself — no ideation call, no dedup screening
  //    (the human already decided). marked used AFTER the draft persists.
  const idea = await claimIdea(groupId);
  let topic: string;
  let angle: string;
  if (idea) {
    topic = idea.text.trim().slice(0, 400);
    angle = '';
    console.log(`[pipeline] idea backlog #${idea.id.slice(0, 8)} claimed: "${topic.slice(0, 60)}"`);
  } else {
    const [history, recentTopics] = await Promise.all([getHistory(effPillar.id), getRecentTopics(groupId)]);
    const id = await chatJson(
      cfg,
      writerModel(cfg),
      ideationPrompt(effPillar, history, newsCtx, recentTopics),
      isIdeationOut,
      6000,
    );
    addUsage(usage, 'ideation', writerModel(cfg), id.usage);
    console.log(`[ideation] topic="${id.data.topic}" tokens=${id.usage.completion}`);
    topic = id.data.topic;
    angle = id.data.angle;
  }

  // 2. writer
  const samples = await getStyleSamples(slot.platform, groupId);
  const w = await chatJson(
    cfg,
    writerModel(cfg),
    writerPrompt(slot.platform, slot.format, topic, angle, effPillar.name, samples),
    writerGuard(slot.format) as (x: unknown) => x is Draft,
    8000,
  );
  addUsage(usage, 'writer', writerModel(cfg), w.usage);
  console.log(`[writer] ok format=${slot.format} tokens=${w.usage.completion}`);

  // 3. critic (separate model) — same guard, structure must stay intact.
  //    Quality gate: the critic scores its own revision 0-10; below threshold → ONE
  //    writer retry with the critique as feedback, then critic again. The better-
  //    scoring draft wins. Score absent (old-shape critic output) → gate off, ship.
  const runWriter = async (feedback?: string) =>
    chatJson(cfg, writerModel(cfg), writerPrompt(slot.platform, slot.format, topic, angle, effPillar.name, samples, feedback),
      writerGuard(slot.format) as (x: unknown) => x is Draft, 8000);
  const runCritic = async (d: Draft) =>
    chatJson(cfg, criticModel(cfg), criticPrompt(slot.platform, slot.format, d),
      writerGuard(slot.format) as (x: unknown) => x is Draft, 8000);

  const c = await runCritic(w.data);
  addUsage(usage, 'critic', criticModel(cfg), c.usage);
  let final = c.data;
  let finalScore = criticScore(final);
  if (finalScore !== null && finalScore < CRITIC_THRESHOLD) {
    console.log(`[critic] score ${finalScore} < ${CRITIC_THRESHOLD} — one regeneration`);
    const w2 = await runWriter(criticFeedback(final, finalScore));
    addUsage(usage, 'writer', writerModel(cfg), w2.usage);
    const c2 = await runCritic(w2.data);
    addUsage(usage, 'critic', criticModel(cfg), c2.usage);
    const score2 = criticScore(c2.data);
    if (score2 === null || score2 > finalScore) {
      final = c2.data;
      finalScore = score2;
      console.log(`[critic] retry won (score ${score2 ?? 'n/a'})`);
    } else {
      console.log(`[critic] original kept (score ${finalScore} >= retry ${score2})`);
    }
  }
  if (finalScore !== null) console.log(`[critic] ok score=${finalScore} tokens=${c.usage.completion}`);
  else console.log(`[critic] ok (no score) tokens=${c.usage.completion}`);
  final = stripCriticMeta(final);
  // tolerant-caption normalization: a string caption (old shape) → structured form
  if ('caption' in (final as Record<string, unknown>)) {
    (final as { caption: CaptionOut }).caption = toCaptionOut((final as { caption: unknown }).caption);
  }

  // 4. persist post (status draft)
  const [post] = await sql`insert into posts
    (group_id, platform, format, pillar_id, topic, caption, body, status, source, llm_usage)
    values (${groupId}, ${slot.platform}, ${slot.format}, ${effPillar.id}, ${topic},
      ${captionOf(final, cfg.captionFooter, cfg.captionCta)}, ${bodyOf(final)}, 'draft', ${source}, ${JSON.stringify(postUsage(usage))}::jsonb)
    returning id`;
  if (!post) throw new Error('insert post failed');
  if (idea) await markIdeaUsed(idea.id); // consumed only once the draft exists
  console.log(`[pipeline] post #${post.id} draft saved (group ${cfg.slug})`);

  return { postId: post.id, slot, topic, draft: final };
}

// Structured caption + group footer → final string, stored in posts.caption at
// generate time (downstream: telegram sends, approval text, FE, resend — all unchanged).
function captionOf(d: Draft, footer: string, ctaOverride: string): string {
  return 'caption' in d ? assembleCaption(d.caption, footer, ctaOverride) : '';
}
function bodyOf(d: Draft): string {
  return JSON.stringify(d);
}

// Called AFTER the post is sent — status + rotation update atomically (spec #11).
export async function markSent(groupId: string, postId: string, slot: Slot): Promise<void> {
  const next = nextState(await getRotation(groupId), slot);
  await commitSent(groupId, postId, slot, next);
  console.log(`[pipeline] post #${postId} sent — rotation advanced: ${next.last_platform}`);
}

export async function markFailed(postId: string, err: unknown): Promise<void> {
  const msg = String((err as Error)?.message ?? err).slice(0, 2000);
  await sql`update posts set status = 'failed', error = ${msg} where id = ${postId}`;
}

export async function createQueuedPost(groupId: string, slot: Slot, source: string): Promise<string> {
  const [post] = await sql`insert into posts
    (group_id, platform, format, pillar_id, topic, caption, body, status, source)
    values (${groupId}, ${slot.platform}, ${slot.format}, ${slot.pillar_id}, '', '', null, 'queued', ${source})
    returning id`;
  if (!post) throw new Error('insert post failed');
  return post.id;
}

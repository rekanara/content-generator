// Orchestrates one run: slot → ideation → writer → critic → (render/send called from outside).
// All queries group-scoped; LLM uses GroupCfg (group ?? env).
import { sql } from './db/pool.ts';
import { getRotation, getActivePillars, commitSent } from './repos/rotation.ts';
import { nextSlot, forcedSlot, plannedSlot, nextState, type Slot, type Platform, type Format } from './state.ts';
import { chatJson, writerModel, criticModel } from './llm.ts';
import { isIdeationOut, writerGuard, writerGuardName, assembleCaption } from './schema.ts';
import { ideationPrompt, writerPrompt, criticPrompt } from './prompts.ts';
import type { StyleSample, PillarFull } from './prompts.ts';
import type { CarouselOut, ReelsOut, TextOut } from './schema.ts';
import type { GroupCfg } from './groups.ts';

export type Draft = CarouselOut | ReelsOut | TextOut;
export type RunResult = { postId: string; slot: Slot; topic: string; draft: Draft };

type UsageAcc = Record<string, { prompt: number; completion: number }>;
const addUsage = (acc: UsageAcc, step: string, u: { prompt: number; completion: number }) => {
  acc[step] = acc[step] ?? { prompt: 0, completion: 0 };
  acc[step]!.prompt += u.prompt;
  acc[step]!.completion += u.completion;
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

  // 1. ideation
  const history = await getHistory(effPillar.id);
  const id = await chatJson(
    cfg,
    writerModel(cfg),
    ideationPrompt(effPillar, history, newsCtx),
    isIdeationOut,
    6000,
  );
  addUsage(usage, 'ideation', id.usage);
  console.log(`[ideation] topic="${id.data.topic}" tokens=${id.usage.completion}`);

  // 2. writer
  const samples = await getStyleSamples(slot.platform, groupId);
  const w = await chatJson(
    cfg,
    writerModel(cfg),
    writerPrompt(slot.platform, slot.format, id.data.topic, id.data.angle, effPillar.name, samples),
    writerGuard(slot.format) as (x: unknown) => x is Draft,
    8000,
  );
  addUsage(usage, 'writer', w.usage);
  console.log(`[writer] ok format=${slot.format} tokens=${w.usage.completion}`);

  // 3. critic (separate model) — same guard, structure must stay intact
  const c = await chatJson(
    cfg,
    criticModel(cfg),
    criticPrompt(slot.platform, slot.format, w.data),
    writerGuard(slot.format) as (x: unknown) => x is Draft,
    8000,
  );
  addUsage(usage, 'critic', c.usage);
  console.log(`[critic] ok tokens=${c.usage.completion}`);

  // 4. persist post (status draft)
  const [post] = await sql`insert into posts
    (group_id, platform, format, pillar_id, topic, caption, body, status, source, llm_usage)
    values (${groupId}, ${slot.platform}, ${slot.format}, ${effPillar.id}, ${id.data.topic},
      ${captionOf(c.data, cfg.captionFooter)}, ${bodyOf(c.data)}, 'draft', ${source}, ${JSON.stringify(usage)})
    returning id`;
  if (!post) throw new Error('insert post failed');
  console.log(`[pipeline] post #${post.id} draft saved (group ${cfg.slug})`);

  return { postId: post.id, slot, topic: id.data.topic, draft: c.data };
}

// Structured caption + group footer → final string, stored in posts.caption at
// generate time (downstream: telegram sends, approval text, FE, resend — all unchanged).
function captionOf(d: Draft, footer: string): string {
  return 'caption' in d ? assembleCaption(d.caption, footer) : '';
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

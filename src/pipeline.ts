// Orkestrasi satu run: slot → ideation → writer → critic → (render/send dipanggil dari luar).
import { sql } from './db.ts';
import { getRotation, getActivePillars, setRotation } from './db.ts';
import { nextSlot, forcedSlot, nextState, type Slot, type Platform, type Format } from './state.ts';
import { chatJson, writerModel, criticModel } from './llm.ts';
import { isIdeationOut, writerGuard, writerGuardName } from './schema.ts';
import { ideationPrompt, writerPrompt, criticPrompt } from './prompts.ts';
import type { StyleSample, PillarFull } from './prompts.ts';
import type { CarouselOut, ReelsOut, TextOut } from './schema.ts';

export type Draft = CarouselOut | ReelsOut | TextOut;
export type RunResult = { postId: number; slot: Slot; topic: string; draft: Draft };

type UsageAcc = Record<string, { prompt: number; completion: number }>;
const addUsage = (acc: UsageAcc, step: string, u: { prompt: number; completion: number }) => {
  acc[step] = acc[step] ?? { prompt: 0, completion: 0 };
  acc[step]!.prompt += u.prompt;
  acc[step]!.completion += u.completion;
};

async function getStyleSamples(platform: Platform): Promise<StyleSample[]> {
  return sql`select title, body, platform from style_samples
    where platform is null or platform = ${platform}
    order by created_at desc limit 8`;
}

async function getHistory(pillarId: number): Promise<string[]> {
  const rows = await sql`select topic from posts
    where pillar_id = ${pillarId} and status in ('sent','rendered','draft')
    order by created_at desc limit 30`;
  return rows.map((r: any) => r.topic);
}

async function getPillar(id: number): Promise<PillarFull> {
  const r = (await sql`select id, name, description, is_news from pillars where id = ${id}`)[0] as any;
  if (!r) throw new Error(`pillar ${id} tidak ditemukan`);
  return r;
}

// RSS context: null → skip (pilar non-news ATAU feed gagal → fallback non-news).
// Step build order 9; sekarang stub null agar pipeline jalan dulu.
async function getNewsContext(): Promise<string | null> {
  return null; // ponytail: diisi di build step rss.ts
}

export async function resolveSlot(forced?: { platform: Platform; format?: Format }): Promise<Slot> {
  const [state, pillars] = await Promise.all([getRotation(), getActivePillars()]);
  if (forced) return forcedSlot(state, pillars, true, forced.platform, forced.format);
  return nextSlot(state, pillars, true);
}

// Fase LLM penuh: ideation → writer → critic. Tanpa render, tanpa kirim.
export async function generateDraft(slot: Slot, source = 'cli'): Promise<RunResult> {
  const pillar = await getPillar(slot.pillar_id);
  const usage: UsageAcc = {};

  // slot untuk pilar berita tapi RSS belum ada → cari pilar non-news terdekat
  let effPillar = pillar;
  if (pillar.is_news) {
    const news = await getNewsContext();
    if (!news) {
      const nonNews = (await sql`select id, name, description, is_news from pillars
        where active and not is_news order by id limit 1`)[0] as any;
      if (!nonNews) throw new Error('pilar berita tanpa RSS dan tidak ada pilar non-news');
      console.log(`[pipeline] pilar berita tanpa RSS → fallback: ${nonNews.name}`);
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
    writerModel(),
    ideationPrompt(effPillar, history, newsCtx),
    isIdeationOut,
    6000,
  );
  addUsage(usage, 'ideation', id.usage);
  console.log(`[ideation] topic="${id.data.topic}" tokens=${id.usage.completion}`);

  // 2. writer
  const samples = await getStyleSamples(slot.platform);
  const w = await chatJson(
    writerModel(),
    writerPrompt(slot.platform, slot.format, id.data.topic, id.data.angle, effPillar.name, samples),
    writerGuard(slot.format) as (x: unknown) => x is Draft,
    8000,
  );
  addUsage(usage, 'writer', w.usage);
  console.log(`[writer] ok format=${slot.format} tokens=${w.usage.completion}`);

  // 3. critic (model terpisah) — guard sama, struktur harus tetap
  const c = await chatJson(
    criticModel(),
    criticPrompt(slot.platform, slot.format, w.data),
    writerGuard(slot.format) as (x: unknown) => x is Draft,
    8000,
  );
  addUsage(usage, 'critic', c.usage);
  console.log(`[critic] ok tokens=${c.usage.completion}`);

  // 4. persist post (status draft)
  const [post] = await sql`insert into posts
    (platform, format, pillar_id, topic, caption, body, status, source, llm_usage)
    values (${slot.platform}, ${slot.format}, ${effPillar.id}, ${id.data.topic},
      ${captionOf(c.data)}, ${bodyOf(c.data)}, 'draft', ${source}, ${JSON.stringify(usage)})
    returning id`;
  if (!post) throw new Error('insert post gagal');
  console.log(`[pipeline] post #${post.id} draft tersimpan`);

  return { postId: post.id, slot, topic: id.data.topic, draft: c.data };
}

function captionOf(d: Draft): string {
  return d && 'caption' in d ? d.caption : '';
}
function bodyOf(d: Draft): string {
  return JSON.stringify(d);
}

// Dipanggil SETELAH post terkirim — update status + rotasi atomik (spec #11).
export async function markSent(postId: number, slot: Slot): Promise<void> {
  const next = nextState(await getRotation(), slot);
  await sql.begin(async (tx) => {
    await tx`update posts set status = 'sent' where id = ${postId}`;
    await tx`update rotation_state set
      last_platform = ${next.last_platform},
      last_ig_format = ${next.last_ig_format},
      last_li_format = ${next.last_li_format},
      last_pillar_id = ${next.last_pillar_id},
      updated_at = now() where id`;
  });
  console.log(`[pipeline] post #${postId} sent — rotasi maju: ${next.last_platform}`);
}

export async function markFailed(postId: number, err: unknown): Promise<void> {
  const msg = String((err as Error)?.message ?? err).slice(0, 2000);
  await sql`update posts set status = 'failed', error = ${msg} where id = ${postId}`;
}

export async function createQueuedPost(slot: Slot, source: string): Promise<number> {
  const [post] = await sql`insert into posts
    (platform, format, pillar_id, topic, caption, body, status, source)
    values (${slot.platform}, ${slot.format}, ${slot.pillar_id}, '', '', null, 'queued', ${source})
    returning id`;
  if (!post) throw new Error('insert post gagal');
  return post.id;
}

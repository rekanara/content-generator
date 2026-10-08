import Parser from 'rss-parser';
import { chatJson, writerModel, BudgetExceededError } from '../llm.ts';
import { recordLlmRun } from '../repos/llm-runs.ts';
import { parseFeed } from '../article.ts';
import type { GroupCfg } from '../groups.ts';
import { isNewsAutofillOut, isNewsScoreOut } from '../schema.ts';
import { getNewsRules, getNewsTopicBrief, existingNewsItems, listActiveNewsSources, listActiveNewsTopicIds, upsertNewsItem } from '../repos/news.ts';

const parser = new Parser({ timeout: 8000 });

type RawNews = { title: string; url: string; summary: string; publishedAt: Date | null };
type Validation = { status: 'valid' | 'rejected'; score: number | null; reason: string };

export type NewsIngestResult = { fetched: number; saved: number; valid: number; rejected: number; skipped: number; feedsFailed: number };
export type NewsAutofill = { allowed_domains: string[]; keywords: string[]; sources: { name: string; url: string }[] };

export async function autofillNewsTopic(cfg: GroupCfg, topic: { name: string; description: string }): Promise<NewsAutofill> {
  const out = await chatJson(cfg, writerModel(cfg), [
    { role: 'system', content: 'You suggest RSS/news configuration for a developer-content news topic. Reply ONLY JSON. Use reputable sources only. URLs must be RSS/feed URLs when likely known, otherwise official news/blog feed URLs. No made-up niche domains.' },
    { role: 'user', content: `Topic: ${topic.name}\nDescription: ${topic.description}\nSuggest 5-12 allowed_domains, 8-20 keywords, and 3-8 RSS/news sources. Output JSON: {"allowed_domains": ["domain.com"], "keywords": ["keyword"], "sources": [{"name": "Source", "url": "https://example.com/feed"}]}` },
  ], isNewsAutofillOut, 2500);
  await recordLlmRun(cfg.id, 'news_autofill', writerModel(cfg), out.usage.prompt, out.usage.completion).catch(() => {});
  return {
    allowed_domains: cleanList(out.data.allowed_domains).slice(0, 12),
    keywords: cleanList(out.data.keywords).slice(0, 20),
    sources: out.data.sources
      .map((s) => ({ name: s.name.trim(), url: s.url.trim() }))
      .filter((s) => s.name && isHttpUrl(s.url))
      .slice(0, 8),
  };
}

function cleanList(xs: string[]): string[] {
  return [...new Set(xs.map((x) => x.trim().toLowerCase()).filter(Boolean))];
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export type IngestProgress = {
  state: 'running' | 'done' | 'failed';
  phase: string; // human-readable current step
  feeds: { total: number; done: number; failed: number };
  items: { total: number; done: number };
  result: NewsIngestResult | null;
  error: string | null;
  startedAt: number;
  updatedAt: number;
};
type OnProgress = (p: Partial<Pick<IngestProgress, 'phase' | 'feeds' | 'items'>>) => void;

// In-process progress per topic (same trust model as the queue: one daemon).
const progress = new Map<string, IngestProgress>();
export const getIngestProgress = (topicId: string): IngestProgress | null => progress.get(topicId) ?? null;

// Fire-and-forget ingest: HTTP returns immediately, the UI polls getIngestProgress.
// false = this topic is already being fetched (no parallel double-run).
export function startIngest(groupId: string, topicId: string, cfg?: GroupCfg): boolean {
  if (progress.get(topicId)?.state === 'running') return false;
  const p: IngestProgress = {
    state: 'running', phase: 'starting', feeds: { total: 0, done: 0, failed: 0 }, items: { total: 0, done: 0 },
    result: null, error: null, startedAt: Date.now(), updatedAt: Date.now(),
  };
  progress.set(topicId, p);
  const update: OnProgress = (u) => { Object.assign(p, u); p.updatedAt = Date.now(); };
  void ingestNewsTopic(groupId, topicId, cfg, update)
    .then((r) => { p.state = 'done'; p.phase = 'finished'; p.result = r; })
    .catch((e) => { p.state = 'failed'; p.phase = 'failed'; p.error = (e as Error).message; })
    .finally(() => { p.updatedAt = Date.now(); });
  return true;
}

// LLM scoring is the slow part (one call per fresh item) — bounded parallelism, not a serial loop.
const SCORE_CONCURRENCY = 5;
const MAX_ITEMS_PER_FEED = 30; // newest first; older entries are noise for a "latest news" topic

async function pool<T>(xs: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) await fn(xs[i++]!);
  }));
}

export async function ingestNewsTopic(groupId: string, topicId: string, cfg?: GroupCfg, onProgress: OnProgress = () => {}): Promise<NewsIngestResult> {
  const [sources, rules, topic, known] = await Promise.all([
    listActiveNewsSources(groupId, topicId), getNewsRules(groupId, topicId), getNewsTopicBrief(groupId, topicId), existingNewsItems(topicId),
  ]);
  if (!sources || !rules || !topic) throw new Error('news topic not found');
  if (sources.length === 0) throw new Error('no active sources — add a source (or use AI autofill) first');

  const feeds = { total: sources.length, done: 0, failed: 0 };
  onProgress({ phase: `fetching ${sources.length} feeds`, feeds });
  const batches = await Promise.all(sources.map(async (s) => {
    try {
      const items = (await fetchFeed(s.url))
        .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
        .slice(0, MAX_ITEMS_PER_FEED);
      return { source: s, items };
    } catch {
      feeds.failed++;
      return { source: s, items: [] as RawNews[] };
    } finally {
      feeds.done++;
      onProgress({ feeds: { ...feeds } });
    }
  }));

  // dedupe by URL across feeds, drop finished work
  const seen = new Set<string>();
  const todo: { sourceId: string; item: RawNews; url: string; domain: string }[] = [];
  let fetched = 0;
  let skipped = 0;
  for (const b of batches) {
    for (const item of b.items) {
      fetched++;
      const url = normalizeUrl(item.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const prev = known.get(url);
      // used/valid stay as they are; AI-judged rejects are not re-scored. Rule rejects re-run (free; rules may have changed).
      if (prev && (prev.status === 'used' || prev.status === 'valid' || prev.reason.startsWith('AI:'))) { skipped++; continue; }
      todo.push({ sourceId: b.source.id, item, url, domain: new URL(url).hostname.replace(/^www\./, '').toLowerCase() });
    }
  }

  const items = { total: todo.length, done: 0 };
  onProgress({ phase: todo.length ? `checking ${todo.length} new items${cfg ? ' (AI scoring)' : ''}` : 'nothing new', items });
  let saved = 0, valid = 0, rejected = 0;
  await pool(todo, SCORE_CONCURRENCY, async ({ sourceId, item, url, domain }) => {
    try {
      let v = validateItem(item, domain, rules);
      if (cfg && v.status === 'valid') v = await scoreItem(cfg, item, domain, v, topic);
      const row = await upsertNewsItem(topicId, sourceId, {
        title: item.title, url, domain, summary: item.summary, published_at: item.publishedAt,
        status: v.status, score: v.score, reason: v.reason,
      });
      saved++;
      if (row.status === 'valid') valid++;
      if (row.status === 'rejected') rejected++;
    } finally {
      items.done++;
      onProgress({ items: { ...items } });
    }
  });
  return { fetched, saved, valid, rejected, skipped, feedsFailed: feeds.failed };
}

export async function ingestNewsGroup(groupId: string, cfg?: GroupCfg): Promise<NewsIngestResult> {
  const topicIds = await listActiveNewsTopicIds(groupId);
  const results = await Promise.allSettled(topicIds.map((id) => ingestNewsTopic(groupId, id, cfg)));
  return results.reduce<NewsIngestResult>((acc, r) => {
    if (r.status !== 'fulfilled') return acc;
    acc.fetched += r.value.fetched;
    acc.saved += r.value.saved;
    acc.valid += r.value.valid;
    acc.rejected += r.value.rejected;
    acc.skipped += r.value.skipped;
    acc.feedsFailed += r.value.feedsFailed;
    return acc;
  }, { fetched: 0, saved: 0, valid: 0, rejected: 0, skipped: 0, feedsFailed: 0 });
}

async function fetchFeed(url: string): Promise<RawNews[]> {
  const feed = await parseFeed(parser, url);
  return (feed.items ?? []).map((it) => ({
    title: String(it.title ?? '').trim(),
    url: String(it.link ?? '').trim(),
    summary: String(it.contentSnippet ?? it.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600),
    publishedAt: parseDate(String(it.isoDate ?? it.pubDate ?? '')),
  })).filter((i) => i.title && i.url);
}

function validateItem(item: RawNews, domain: string, rules: { freshness_hours: number; min_sources: number; allowed_domains: string[]; blocked_domains: string[]; keywords: string[] }): Validation {
  if (rules.blocked_domains.includes(domain)) return { status: 'rejected', score: 0, reason: `blocked domain: ${domain}` };
  if (rules.allowed_domains.length > 0 && !rules.allowed_domains.includes(domain)) return { status: 'rejected', score: 0, reason: `domain not allowed: ${domain}` };
  if (!item.publishedAt) return { status: 'rejected', score: 20, reason: 'missing published date' };
  const ageHours = (Date.now() - item.publishedAt.getTime()) / 3600_000;
  if (ageHours > rules.freshness_hours) return { status: 'rejected', score: 25, reason: `older than ${rules.freshness_hours} hours` };
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  if (rules.keywords.length > 0 && !rules.keywords.some((k) => haystack.includes(k.toLowerCase()))) {
    return { status: 'rejected', score: 40, reason: 'keywords not matched' };
  }
  const freshnessScore = Math.max(0, 60 - Math.floor(ageHours));
  const keywordScore = rules.keywords.length === 0 ? 20 : 30;
  return { status: 'valid', score: Math.min(100, freshnessScore + keywordScore), reason: 'fresh source match' };
}

async function scoreItem(cfg: GroupCfg, item: RawNews, domain: string, fallback: Validation, topic: { name: string; description: string }): Promise<Validation> {
  try {
    const out = await chatJson(cfg, writerModel(cfg), [
      { role: 'system', content: 'You screen news items for a content account. The topic definition decides what is relevant. Reply ONLY JSON.' },
      { role: 'user', content: `Topic: ${topic.name}\nTopic description: ${topic.description || '(none)'}\n\nDomain: ${domain}\nTitle: ${item.title}\nSummary: ${item.summary}\n\nScore 0-100: how well does this item fit THIS topic, combined with recency, source credibility, novelty, and content potential. Judge relevance ONLY against the topic description above — do not apply any other audience or niche. Below 60 = reject. Output JSON: {"score": 0, "reason": "short reason"}` },
    ], isNewsScoreOut, 800);
    await recordLlmRun(cfg.id, 'news_score', writerModel(cfg), out.usage.prompt, out.usage.completion).catch(() => {});
    const score = Math.round(out.data.score);
    return { status: score >= 60 ? 'valid' : 'rejected', score, reason: `AI: ${out.data.reason}` };
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e; // stop the ingest; unscored items retry next fetch
    return { ...fallback, reason: `${fallback.reason}; AI scoring failed: ${(e as Error).message.slice(0, 120)}` };
  }
}

function normalizeUrl(s: string): string | null {
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function parseDate(s: string): Date | null {
  const n = Date.parse(s);
  return Number.isFinite(n) ? new Date(n) : null;
}

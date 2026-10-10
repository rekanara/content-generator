import Parser from 'rss-parser';
import { chatJson, writerModel, BudgetExceededError } from '../llm.ts';
import { recordLlmRun } from '../repos/llm-runs.ts';
import { parseFeed, fetchArticle } from '../article.ts';
import { newsUrlAnalysisPrompt } from '../prompts.ts';
import type { GroupCfg } from '../groups.ts';
import { isNewsAutofillOut, isNewsScoreOut, isNewsUrlAnalysisOut, sameStory } from '../schema.ts';
import type { NewsItem } from '@workspace/shared';
import { getNewsRules, getNewsTopicBrief, existingNewsItems, listActiveNewsSources, listActiveNewsTopicIds, upsertNewsItem, getNewsItemByUrl, setNewsItemSources, listNewsItemSources } from '../repos/news.ts';

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

export type FetchUrlResult = {
  item: NewsItem;
  matchedSource: string | null;
  analysis: { angle: string; key_points: string[] } | null;
  known: boolean;
  extra: { url: string; domain: string; title: string }[]; // extra sources kept with the item
  skipped: { url: string; reason: string }[];              // links that could not be used (unreadable / other story / duplicate)
};

export const MAX_FETCH_URLS = 5;

// One human-picked story from 1..MAX_FETCH_URLS links: crawl every URL, look for the same story in the topic's
// RSS feeds (source_id when found), then ONE AI analysis across all readable articles. Link 1 is the anchor
// (item url/title/dedup); the rest are stored as extra sources and later feed the research step. The anchor
// URL + domain are ALWAYS stored — that is the content's source line, RSS match or not.
export async function fetchNewsUrls(cfg: GroupCfg, topicId: string, rawUrls: string[]): Promise<FetchUrlResult> {
  const urls = [...new Set(rawUrls.map((u) => u.trim()).filter(Boolean))].slice(0, MAX_FETCH_URLS);
  if (urls.length === 0) throw new Error('no URL given');
  const [sources, topic, known] = await Promise.all([
    listActiveNewsSources(cfg.id, topicId), getNewsTopicBrief(cfg.id, topicId), existingNewsItems(topicId),
  ]);
  if (!sources || !topic) throw new Error('news topic not found');

  const skipped: FetchUrlResult['skipped'] = [];
  const read = (await Promise.all(urls.map(async (raw) => ({ raw, article: await fetchArticle(raw) }))));
  const articles: { article: NonNullable<(typeof read)[number]['article']>; url: string; domain: string }[] = [];
  for (const r of read) {
    if (!r.article) { skipped.push({ url: r.raw, reason: 'could not read (not an HTML page, blocked, or private address)' }); continue; }
    if (!r.article.title) { skipped.push({ url: r.raw, reason: 'page has no readable title' }); continue; }
    const url = normalizeUrl(r.article.canonical && sameHost(r.article.canonical, r.article.url) ? r.article.canonical : r.article.url) ?? r.article.url;
    if (articles.some((a) => sameStory(a.url, url))) { skipped.push({ url: r.raw, reason: 'duplicate of another link' }); continue; }
    articles.push({ article: r.article, url, domain: new URL(url).hostname.replace(/^www\./, '').toLowerCase() });
  }
  if (articles.length === 0) throw new Error(urls.length === 1 ? 'could not read that URL (not an HTML page, blocked, or private address, or no readable title)' : 'could not read any of the URLs');
  // the first link the user typed stays the anchor if it was readable; else the first readable one
  const anchor = articles[0]!;

  // already stored and finished (used/valid) → never overwrite its status
  const prev = [...known.keys()].find((k) => sameStory(k, anchor.url));
  if (prev && ['used', 'valid'].includes(known.get(prev)!.status)) {
    const row = await getNewsItemByUrl(topicId, prev);
    if (row) {
      // still attach newly given links to a VALID, ungenerated item — that is the point of re-adding sources
      if (row.status === 'valid' && !row.post_id && articles.length > 1) {
        const old = await listNewsItemSources(row.id);
        const merged = new Map(old.map((e) => [e.url, e]));
        for (const a of articles.slice(1)) merged.set(a.url, { url: a.url, domain: a.domain, title: a.article.title });
        await setNewsItemSources(row.id, [...merged.values()].slice(0, MAX_FETCH_URLS - 1));
      }
      return { item: row, matchedSource: null, analysis: null, known: true, extra: await listNewsItemSources(row.id), skipped };
    }
  }

  // same story in any of the topic's feeds → source_id + feed date/summary fill gaps
  let match: { sourceId: string; name: string; item: RawNews } | null = null;
  const feeds = await Promise.allSettled(sources.map(async (s) => ({ s, items: await fetchFeed(s.url) })));
  for (const f of feeds) {
    if (f.status !== 'fulfilled') continue;
    const it = f.value.items.find((i) => sameStory(i.url, anchor.url) || sameStory(i.url, anchor.article.url));
    if (it) { match = { sourceId: f.value.s.id, name: f.value.s.name, item: it }; break; }
  }

  const summaryOf = (a: (typeof articles)[number]) => (a.article.summary || a.article.text.slice(0, 600)).slice(0, 600);
  const anchorSummary = (anchor.article.summary || match?.item.summary || anchor.article.text.slice(0, 600)).slice(0, 600);
  const publishedAt = anchor.article.publishedAt ?? match?.item.publishedAt ?? null;
  const forAi = articles.map((a, i) => ({
    title: a.article.title, url: a.url, domain: a.domain, summary: i === 0 ? anchorSummary : summaryOf(a), text: a.article.text.slice(0, articles.length > 1 ? 8000 : 12000),
  }));
  const out = await chatJson(cfg, writerModel(cfg), newsUrlAnalysisPrompt(topic, forAi), isNewsUrlAnalysisOut, 2000, 120_000);
  await recordLlmRun(cfg.id, 'news_score', writerModel(cfg), out.usage.prompt, out.usage.completion).catch(() => {});
  const score = Math.round(out.data.score);

  // articles the AI flagged as a different story are dropped (article numbers are 1-based; 1 = anchor, never dropped)
  const unrelated = new Set((out.data.unrelated ?? []).filter((n) => n >= 2 && n <= articles.length));
  const kept = articles.filter((_, i) => !unrelated.has(i + 1));
  for (const n of unrelated) skipped.push({ url: articles[n - 1]!.url, reason: 'looks like a different story than link 1' });
  const extra = kept.slice(1).map((a) => ({ url: a.url, domain: a.domain, title: a.article.title }));

  const item = await upsertNewsItem(topicId, match?.sourceId ?? null, {
    title: anchor.article.title, url: anchor.url, domain: anchor.domain, summary: anchorSummary, published_at: publishedAt,
    status: score >= 50 ? 'valid' : 'rejected', score,
    reason: `AI URL${kept.length > 1 ? ` (${kept.length} sources)` : ''}: ${out.data.reason}${out.data.angle ? ` · angle: ${out.data.angle}` : ''}`.slice(0, 1000),
  });
  await setNewsItemSources(item.id, extra);
  return { item, matchedSource: match?.name ?? null, analysis: { angle: out.data.angle, key_points: out.data.key_points }, known: false, extra, skipped };
}

// Single-link convenience (Telegram flow).
export const fetchNewsUrl = (cfg: GroupCfg, topicId: string, rawUrl: string): Promise<FetchUrlResult> => fetchNewsUrls(cfg, topicId, [rawUrl]);

function sameHost(a: string, b: string): boolean {
  try { return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, ''); } catch { return false; }
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

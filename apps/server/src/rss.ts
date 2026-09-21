// RSS news context: fetch feeds → cache feeds_cache → pick fresh items.
// Fail-safe: any error → null → pipeline falls back to non-news pillar.
import Parser from 'rss-parser';
import { sql } from './db/pool.ts';

export const FEEDS: string[] = [
  'https://hnrss.org/frontpage',
  'https://dev.to/feed/',
  'https://blog.rust-lang.org/feed.xml',
  'https://engineering.fb.com/feed/',
];

const TTL_MS = 30 * 60 * 1000; // refetch after 30 min
const MAX_AGE_H = 48; // only items published within 48h
const PICK = 8; // items handed to ideation

export type Item = { title: string; link: string; publishedAt: number };

// Pure: filter fresh + dedup + pick top N — unit-testable.
export function pickFresh(items: Item[], now = Date.now()): Item[] {
  const min = now - MAX_AGE_H * 3600_000;
  const seen = new Set<string>();
  return items
    .filter((i) => {
      if (!i.title || i.publishedAt < min) return false;
      const t = i.title.toLowerCase().trim();
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, PICK);
}

export function formatContext(items: Item[]): string | null {
  if (items.length === 0) return null;
  return items.map((i) => `- ${i.title}\n  ${i.link}`).join('\n');
}

async function fetchOne(p: Parser, url: string): Promise<Item[]> {
  const feed = await p.parseURL(url);
  return (feed.items ?? []).map((it) => ({
    title: String(it.title ?? ''),
    link: String(it.link ?? ''),
    publishedAt: new Date(it.isoDate ?? it.pubDate ?? Date.now()).getTime(),
  }));
}

async function cachedFetch(url: string, p: Parser): Promise<Item[]> {
  const [row] = await sql`select fetched_at, items from feeds_cache where url = ${url}`;
  if (row && Date.now() - new Date(row.fetched_at).getTime() < TTL_MS) {
    // tolerant read: legacy rows were double-encoded strings
    const cached = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
    return (Array.isArray(cached) ? cached : []) as Item[];
  }
  const items = await fetchOne(p, url); // throws → caller handles per-feed
  await sql`insert into feeds_cache (url, fetched_at, items) values (${url}, now(), ${JSON.stringify(items)}::jsonb)
    on conflict (url) do update set fetched_at = now(), items = excluded.items`;
  return items;
}

export async function getNewsContext(): Promise<string | null> {
  const p = new Parser({ timeout: 8000 });
  const results = await Promise.allSettled(FEEDS.map((u) => cachedFetch(u, p)));
  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (results.every((r) => r.status === 'rejected')) return null; // total failure
  const ctx = formatContext(pickFresh(items));
  if (!ctx) console.log('[rss] feeds ok but no fresh items — falling back to non-news pillar');
  return ctx;
}

// RSS pure-function unit tests (no network, no DB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFresh, formatContext, type Item } from '../src/rss.ts';

const now = Date.now();
const h = (n: number) => now - n * 3600_000;
const it = (title: string, publishedAt: number): Item => ({ title, link: 'https://x/' + title, publishedAt });

test('pickFresh: filters stale (>48h), keeps fresh, sorted newest-first', () => {
  const items = [it('old', h(72)), it('fresh1', h(5)), it('fresh2', h(1))];
  const out = pickFresh(items, now);
  assert.deepEqual(out.map((i) => i.title), ['fresh2', 'fresh1']);
});

test('pickFresh: dedups same title (case-insensitive)', () => {
  const items = [it('Rust 2.0 Released', h(2)), it('rust 2.0 released', h(1))];
  assert.equal(pickFresh(items, now).length, 1);
});

test('pickFresh: caps at 8 items, drops empty titles', () => {
  const items = Array.from({ length: 12 }, (_, i) => it('t' + i, h(1)));
  items.push(it('', h(1)));
  const out = pickFresh(items, now);
  assert.equal(out.length, 8);
});

test('pickFresh: future timestamps kept (clock skew tolerance), invalid date dropped', () => {
  const items = [it('future', now + 3600_000), it('zero-epoch', 0)];
  const out = pickFresh(items, now);
  assert.deepEqual(out.map((i) => i.title), ['future']);
});

test('formatContext: null when empty, list when items', () => {
  assert.equal(formatContext([]), null);
  const s = formatContext([it('A', h(1))])!;
  assert.match(s, /- A\n\s+https:\/\/x\/A/);
});

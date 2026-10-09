import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlMeta } from '../src/article.ts';
import { sameStory, isNewsUrlAnalysisOut } from '../src/schema.ts';

test('htmlMeta: og tags win, title fallback, date + canonical', () => {
  const m = htmlMeta(`<html><head><title>Fallback</title>
    <meta property="og:title" content="Real &amp; Title">
    <meta name="description" content="Short summary">
    <meta property="article:published_time" content="2026-10-01T08:00:00Z">
    <link rel="canonical" href="https://news.site/a/b"></head></html>`);
  assert.equal(m.title, 'Real & Title');
  assert.equal(m.summary, 'Short summary');
  assert.equal(m.publishedAt?.toISOString(), '2026-10-01T08:00:00.000Z');
  assert.equal(m.canonical, 'https://news.site/a/b');
  assert.equal(htmlMeta('<title>Only</title>').title, 'Only');
  assert.equal(htmlMeta('<p>x</p>').publishedAt, null);
});

test('sameStory: ignores www/m., query, hash, trailing slash, case', () => {
  assert.ok(sameStory('https://www.site.com/news/A-1/?utm=x#top', 'https://m.site.com/news/a-1'));
  assert.ok(!sameStory('https://site.com/news/a-1', 'https://site.com/news/a-2'));
  assert.ok(!sameStory('https://site.com/a', 'https://other.com/a'));
  assert.ok(!sameStory('not a url', 'https://site.com/a'));
});

test('isNewsUrlAnalysisOut: shape', () => {
  assert.ok(isNewsUrlAnalysisOut({ score: 80, reason: 'fits', angle: 'x', key_points: ['a'] }));
  assert.ok(!isNewsUrlAnalysisOut({ score: 120, reason: 'fits', angle: 'x', key_points: [] }));
  assert.ok(!isNewsUrlAnalysisOut({ score: 80, reason: '', angle: 'x', key_points: [] }));
});

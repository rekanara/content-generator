// flattenBody unit test (pure — no DB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenBody } from '../src/repos/posts.ts';

test('flattenBody: text post → body as-is', () => {
  assert.equal(flattenBody({ body: 'hello world' }), 'hello world');
});

test('flattenBody: carousel → numbered slides', () => {
  const out = flattenBody({ slides: [
    { headline: 'H1', body: 'B1' },
    { headline: 'H2', body: 'B2' },
  ] });
  assert.equal(out, '1. H1\nB1\n\n2. H2\nB2');
});

test('flattenBody: reels → numbered scenes with overlay', () => {
  const out = flattenBody({ scenes: [
    { overlay_text: 'O1', narration: 'N1' },
    { overlay_text: 'O2', narration: 'N2' },
  ] });
  assert.equal(out, '1. [O1] N1\n2. [O2] N2');
});

test('flattenBody: null → empty string, unknown shape → JSON', () => {
  assert.equal(flattenBody(null), '');
  assert.equal(flattenBody(JSON.parse('{"x":1}')), '{"x":1}');
});

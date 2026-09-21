import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCmd, parseCallback } from '../src/bot.ts';

const SLUGS = ['default', 'brand2'];

test('parseCmd: bare /gen', () => {
  assert.deepEqual(parseCmd('/gen', SLUGS), { t: 'gen', slug: undefined, platform: undefined, format: undefined });
});

test('parseCmd: /gen with platform', () => {
  assert.deepEqual(parseCmd('/gen instagram', SLUGS), { t: 'gen', slug: undefined, platform: 'instagram', format: undefined });
});

test('parseCmd: /gen platform + format', () => {
  assert.deepEqual(parseCmd('/gen linkedin pdf', SLUGS), { t: 'gen', slug: undefined, platform: 'linkedin', format: 'pdf' });
});

test('parseCmd: /gen with group slug', () => {
  assert.deepEqual(parseCmd('/gen brand2 instagram carousel', SLUGS), { t: 'gen', slug: 'brand2', platform: 'instagram', format: 'carousel' });
});

test('parseCmd: unknown slug → treated as platform (invalid)', () => {
  const c = parseCmd('/gen foobar', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: case insensitive + spaces', () => {
  assert.deepEqual(parseCmd('  /Gen  INSTAGRAM   Carousel  ', SLUGS), { t: 'gen', slug: undefined, platform: 'instagram', format: 'carousel' });
});

test('parseCmd: invalid platform', () => {
  const c = parseCmd('/gen twitter', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: format without platform invalid', () => {
  const c = parseCmd('/gen pdf', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: invalid format', () => {
  const c = parseCmd('/gen instagram video', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: /status', () => {
  assert.deepEqual(parseCmd('/status', SLUGS), { t: 'status', slug: undefined });
});

test('parseCmd: /status with slug', () => {
  assert.deepEqual(parseCmd('/status brand2', SLUGS), { t: 'status', slug: 'brand2' });
});

// ---------- parseCmd: /rerender ----------

test('parseCmd: bare /rerender', () => {
  assert.deepEqual(parseCmd('/rerender', SLUGS), { t: 'rerender', slug: undefined });
});

test('parseCmd: /rerender with slug', () => {
  assert.deepEqual(parseCmd('/rerender brand2', SLUGS), { t: 'rerender', slug: 'brand2' });
});

test('parseCmd: /rerender unknown slug → slug undefined (default group)', () => {
  assert.deepEqual(parseCmd('/rerender foobar', SLUGS), { t: 'rerender', slug: undefined });
});

test('parseCmd: /help and /start', () => {
  assert.deepEqual(parseCmd('/help', SLUGS), { t: 'help' });
  assert.deepEqual(parseCmd('/start', SLUGS), { t: 'help' });
});

test('parseCmd: random text', () => {
  const c = parseCmd('hello bot', SLUGS);
  assert.equal(c.t, 'unknown');
});

// ---------- parseCallback (approval gate buttons) ----------

const UUID = '0192ab6e-5f78-7abc-8def-0123456789ab';

test('parseCallback: approve:<uuid>', () => {
  assert.deepEqual(parseCallback(`approve:${UUID}`), { t: 'approve', postId: UUID });
});

test('parseCallback: reject:<uuid>', () => {
  assert.deepEqual(parseCallback(`reject:${UUID}`), { t: 'reject', postId: UUID });
});

test('parseCallback: uppercase uuid → normalized lowercase', () => {
  const c = parseCallback(`APPROVE:${UUID.toUpperCase()}`);
  assert.deepEqual(c, { t: 'approve', postId: UUID });
});

test('parseCallback: non-uuid payload → null', () => {
  assert.equal(parseCallback('approve:not-a-uuid'), null);
  assert.equal(parseCallback('approve:123'), null);
});

test('parseCallback: unknown action → null', () => {
  assert.equal(parseCallback(`delete:${UUID}`), null);
  assert.equal(parseCallback(UUID), null);
  assert.equal(parseCallback(''), null);
});

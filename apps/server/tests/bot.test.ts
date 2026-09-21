import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCmd, parseCallback, parseOverrideDate } from '../src/bot.ts';

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

test('parseCallback: skip_cover:<uuid>', () => {
  assert.deepEqual(parseCallback(`skip_cover:${UUID}`), { t: 'skip_cover', postId: UUID });
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

// ---------- parseCallback: override flow buttons ----------

test('parseCallback: ovtype:mix / image_only / text_only', () => {
  assert.deepEqual(parseCallback('ovtype:mix'), { t: 'ovtype', value: 'mix' });
  assert.deepEqual(parseCallback('ovtype:image_only'), { t: 'ovtype', value: 'image_only' });
  assert.deepEqual(parseCallback('ovtype:text_only'), { t: 'ovtype', value: 'text_only' });
});

test('parseCallback: ovdone', () => {
  assert.deepEqual(parseCallback('ovdone'), { t: 'ovdone' });
});

test('parseCallback: invalid ovtype value → null', () => {
  assert.equal(parseCallback('ovtype:video'), null);
  assert.equal(parseCallback('ovtype:'), null);
});

// ---------- parseOverrideDate (pure) ----------

test('parseOverrideDate: ISO format', () => {
  assert.deepEqual(parseOverrideDate('2026-10-01', '2026-09-21'), { date: '2026-10-01', past: false });
});

test('parseOverrideDate: DD-MM-YYYY (Indonesian) maps to same date', () => {
  assert.deepEqual(parseOverrideDate('01-10-2026', '2026-09-21'), { date: '2026-10-01', past: false });
  assert.deepEqual(parseOverrideDate('25-12-2026', '2026-09-21'), { date: '2026-12-25', past: false });
});

test('parseOverrideDate: past detection', () => {
  assert.deepEqual(parseOverrideDate('2026-01-01', '2026-09-21'), { date: '2026-01-01', past: true });
  assert.deepEqual(parseOverrideDate('2026-09-21', '2026-09-21'), { date: '2026-09-21', past: false }); // today ok
});

test('parseOverrideDate: invalid shapes → null', () => {
  assert.equal(parseOverrideDate('tomorrow', '2026-09-21'), null);
  assert.equal(parseOverrideDate('2026/10/01', '2026-09-21'), null);
  assert.equal(parseOverrideDate('01/10/2026', '2026-09-21'), null);
  assert.equal(parseOverrideDate('', '2026-09-21'), null);
});

test('parseOverrideDate: calendar-rollover dates rejected (31-02)', () => {
  assert.equal(parseOverrideDate('31-02-2026', '2026-09-21'), null); // Feb never has 31 days
  assert.equal(parseOverrideDate('2026-02-31', '2026-09-21'), null);
});

test('parseCmd: /override with and without slug', () => {
  assert.deepEqual(parseCmd('/override', SLUGS), { t: 'override', slug: undefined });
  assert.deepEqual(parseCmd('/override brand2', SLUGS), { t: 'override', slug: 'brand2' });
});

test('parseCmd: /cancel', () => {
  assert.deepEqual(parseCmd('/cancel', SLUGS), { t: 'cancel' });
});

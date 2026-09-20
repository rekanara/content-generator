import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCmd } from '../src/bot.ts';

const SLUGS = ['default', 'brand2'];

test('parseCmd: /gen polos', () => {
  assert.deepEqual(parseCmd('/gen', SLUGS), { t: 'gen', slug: undefined, platform: undefined, format: undefined });
});

test('parseCmd: /gen dengan platform', () => {
  assert.deepEqual(parseCmd('/gen instagram', SLUGS), { t: 'gen', slug: undefined, platform: 'instagram', format: undefined });
});

test('parseCmd: /gen platform + format', () => {
  assert.deepEqual(parseCmd('/gen linkedin pdf', SLUGS), { t: 'gen', slug: undefined, platform: 'linkedin', format: 'pdf' });
});

test('parseCmd: /gen dengan slug group', () => {
  assert.deepEqual(parseCmd('/gen brand2 instagram carousel', SLUGS), { t: 'gen', slug: 'brand2', platform: 'instagram', format: 'carousel' });
});

test('parseCmd: slug tak dikenal → diperlakukan platform (invalid)', () => {
  const c = parseCmd('/gen foobar', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: case insensitive + spasi', () => {
  assert.deepEqual(parseCmd('  /Gen  INSTAGRAM   Carousel  ', SLUGS), { t: 'gen', slug: undefined, platform: 'instagram', format: 'carousel' });
});

test('parseCmd: platform invalid', () => {
  const c = parseCmd('/gen twitter', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: format tanpa platform invalid', () => {
  const c = parseCmd('/gen pdf', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: format invalid', () => {
  const c = parseCmd('/gen instagram video', SLUGS);
  assert.equal(c.t, 'unknown');
});

test('parseCmd: /status', () => {
  assert.deepEqual(parseCmd('/status', SLUGS), { t: 'status', slug: undefined });
});

test('parseCmd: /status dengan slug', () => {
  assert.deepEqual(parseCmd('/status brand2', SLUGS), { t: 'status', slug: 'brand2' });
});

test('parseCmd: /help dan /start', () => {
  assert.deepEqual(parseCmd('/help', SLUGS), { t: 'help' });
  assert.deepEqual(parseCmd('/start', SLUGS), { t: 'help' });
});

test('parseCmd: teks acak', () => {
  const c = parseCmd('halo bot', SLUGS);
  assert.equal(c.t, 'unknown');
});

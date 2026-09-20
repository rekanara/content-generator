import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCmd } from '../src/bot.ts';

test('parseCmd: /gen polos', () => {
  assert.deepEqual(parseCmd('/gen'), { t: 'gen', platform: undefined, format: undefined });
});

test('parseCmd: /gen dengan platform', () => {
  assert.deepEqual(parseCmd('/gen instagram'), { t: 'gen', platform: 'instagram', format: undefined });
});

test('parseCmd: /gen platform + format', () => {
  assert.deepEqual(parseCmd('/gen linkedin pdf'), { t: 'gen', platform: 'linkedin', format: 'pdf' });
});

test('parseCmd: case insensitive + spasi', () => {
  assert.deepEqual(parseCmd('  /Gen  INSTAGRAM   Carousel  '), { t: 'gen', platform: 'instagram', format: 'carousel' });
});

test('parseCmd: platform invalid', () => {
  const c = parseCmd('/gen twitter');
  assert.equal(c.t, 'unknown');
});

test('parseCmd: format tanpa platform invalid', () => {
  const c = parseCmd('/gen pdf');
  assert.equal(c.t, 'unknown');
});

test('parseCmd: format invalid', () => {
  const c = parseCmd('/gen instagram video');
  assert.equal(c.t, 'unknown');
});

test('parseCmd: /status', () => {
  assert.deepEqual(parseCmd('/status'), { t: 'status' });
});

test('parseCmd: /help dan /start', () => {
  assert.deepEqual(parseCmd('/help'), { t: 'help' });
  assert.deepEqual(parseCmd('/start'), { t: 'help' });
});

test('parseCmd: teks acak', () => {
  const c = parseCmd('halo bot');
  assert.equal(c.t, 'unknown');
});

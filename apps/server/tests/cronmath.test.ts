// cronmath: prevFire + nextFires on the cron package's CronTime (fixed dates → deterministic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prevFire, nextFires } from '../src/cronmath.ts';

// absolute instants via explicit +07:00 offset — host TZ can't affect results
const D = (s: string) => new Date(s);
const ISO = (d: Date | null) => d?.toISOString() ?? null;

// 2026-09-21 is a Monday.
test('prevFire: daily 07:00 — later same day → today 07:00', () => {
  const p = prevFire('0 7 * * *', D('2026-09-21T10:00:00+07:00'));
  assert.equal(ISO(p), '2026-09-21T00:00:00.000Z');
});

test('prevFire: daily 07:00 — before today fire → yesterday', () => {
  const p = prevFire('0 7 * * *', D('2026-09-21T06:00:00+07:00'));
  assert.equal(ISO(p), '2026-09-20T00:00:00.000Z');
});

test('prevFire: exact fire second still counts as fired (no infinite loop)', () => {
  const p = prevFire('0 7 * * *', D('2026-09-21T07:00:30+07:00'));
  assert.equal(ISO(p), '2026-09-21T00:00:00.000Z');
});

test('prevFire: weekly Monday — mid-week → last Monday', () => {
  const p = prevFire('0 7 * * 1', D('2026-09-23T12:00:00+07:00')); // Wednesday
  assert.equal(ISO(p), '2026-09-21T00:00:00.000Z');
});

test('prevFire: weekly Monday — same Monday after fire → today', () => {
  const p = prevFire('0 7 * * 1', D('2026-09-21T10:00:00+07:00'));
  assert.equal(ISO(p), '2026-09-21T00:00:00.000Z');
});

test('prevFire: no fire within lookback → null', () => {
  // monthly on the 1st, fire was Sep 1, lookback 10 days from Sep 21 → nothing
  const p = prevFire('0 7 1 * *', D('2026-09-21T10:00:00+07:00'), 10);
  assert.equal(p, null);
});

test('prevFire: invalid expr → null (never alert on garbage)', () => {
  assert.equal(prevFire('not a cron', new Date()), null);
  assert.equal(prevFire('99 99 * * *', new Date()), null);
});

test('nextFires: daily 07:00 — next 3 occurrences', () => {
  const f = nextFires('0 7 * * *', D('2026-09-21T10:00:00+07:00'), 3);
  assert.deepEqual(f.map(ISO), [
    '2026-09-22T00:00:00.000Z',
    '2026-09-23T00:00:00.000Z',
    '2026-09-24T00:00:00.000Z',
  ]);
});

test('nextFires: weekly Monday from Wednesday → next two Mondays', () => {
  const f = nextFires('0 7 * * 1', D('2026-09-23T12:00:00+07:00'), 2);
  assert.deepEqual(f.map(ISO), [
    '2026-09-28T00:00:00.000Z',
    '2026-10-05T00:00:00.000Z',
  ]);
});

test('nextFires: n=0 or invalid expr → []', () => {
  assert.deepEqual(nextFires('0 7 * * *', new Date(), 0), []);
  assert.deepEqual(nextFires('garbage', new Date(), 3), []);
});

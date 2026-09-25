// Critic scoring gate — pure helpers: score read (tolerant), meta strip, feedback line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criticScore, stripCriticMeta, criticFeedback } from '../src/schema.ts';

test('criticScore reads and clamps a numeric score', () => {
  assert.equal(criticScore({ score: 8 }), 8);
  assert.equal(criticScore({ score: 6.4 }), 6); // rounded
  assert.equal(criticScore({ score: 15 }), 10); // clamped up
  assert.equal(criticScore({ score: -3 }), 0); // clamped down
});

test('criticScore is null when absent, non-numeric, or not an object', () => {
  assert.equal(criticScore({}), null);
  assert.equal(criticScore({ score: '7' }), null);
  assert.equal(criticScore({ score: NaN }), null);
  assert.equal(criticScore(null), null);
  assert.equal(criticScore('7'), null);
});

test('criticScore works on a real-ish critic output with nested draft fields', () => {
  const out = { caption: { title: 't', subtitle: 's', cta: '', tags: ['#git'] }, slides: [{ headline: 'h', body: 'b' }], score: 5, notes: 'weak hook' };
  assert.equal(criticScore(out), 5);
});

test('stripCriticMeta removes score+notes without mutating the original', () => {
  const out = { body: 'text', score: 6, notes: 'x' };
  const stripped = stripCriticMeta(out);
  assert.deepEqual(stripped, { body: 'text' });
  assert.equal('score' in out, true); // original untouched
});

test('stripCriticMeta leaves a clean draft unchanged', () => {
  const out = { body: 'text' };
  assert.deepEqual(stripCriticMeta(out), { body: 'text' });
});

test('criticFeedback prefers notes, falls back to a generic line', () => {
  assert.equal(criticFeedback({ notes: 'hook lemah' }, 5), 'Editor rejected the previous attempt (score 5/10): hook lemah');
  assert.equal(criticFeedback({}, 4), 'Editor rejected the previous attempt (score 4/10): the editor found it below publish quality');
  assert.equal(criticFeedback(null, 3), 'Editor rejected the previous attempt (score 3/10): the editor found it below publish quality');
});

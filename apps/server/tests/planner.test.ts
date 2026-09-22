// AI planner pure parts: output guard + prompt builder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlannerOut } from '../src/schema.ts';
import { plannerPrompt } from '../src/prompts.ts';
import { parseCmd } from '../src/bot.ts';

const SLUGS = ['default'];

// ---------- isPlannerOut ----------

test('isPlannerOut: valid proposals pass', () => {
  assert.equal(isPlannerOut({ plans: [] }), true);
  assert.equal(isPlannerOut({
    plans: [{ for_date: '2026-10-01', template_id: 'abc', note: 'rekomendasi repo github' }],
  }), true);
  assert.equal(isPlannerOut({
    plans: [{
      for_date: '2026-10-01', template_id: 'abc', pillar_id: 'p1',
      platform: 'instagram', format: 'carousel', note: 'x',
    }],
  }), true);
});

test('isPlannerOut: null optionals + string|null tolerance', () => {
  assert.equal(isPlannerOut({ plans: [{ for_date: '2026-10-01', template_id: 'a', pillar_id: null, platform: null, format: null, note: 'n' }] }), true);
});

test('isPlannerOut: rejects malformed shapes', () => {
  assert.equal(isPlannerOut(null), false);
  assert.equal(isPlannerOut({}), false);
  assert.equal(isPlannerOut({ plans: 'nope' }), false);
  assert.equal(isPlannerOut({ plans: [{ template_id: 'a', note: 'n' }] }), false); // no for_date
  assert.equal(isPlannerOut({ plans: [{ for_date: '01-10-2026', template_id: 'a', note: 'n' }] }), false); // DD-MM not ISO
  assert.equal(isPlannerOut({ plans: [{ for_date: '2026-10-01', note: 'n' }] }), false); // no template_id
  assert.equal(isPlannerOut({ plans: [{ for_date: '2026-10-01', template_id: 'a' }] }), false); // no note
  assert.equal(isPlannerOut({ plans: [{ for_date: '2026-10-01', template_id: 'a', note: 'n', platform: 'twitter' }] }), false);
  assert.equal(isPlannerOut({ plans: [{ for_date: '2026-10-01', template_id: 'a', note: 'n', format: 'video' }] }), false);
  assert.equal(isPlannerOut({ plans: Array.from({ length: 9 }, () => ({ for_date: '2026-10-01', template_id: 'a', note: 'n' })) }), false); // > 8
});

// ---------- plannerPrompt ----------

const RUN = {
  date: '2026-10-02', weekday: 'Friday', platform: 'instagram' as const, format: 'carousel' as const,
  pillar: { id: 'p1', name: 'Tips', description: 'praktis' },
};
const TPL = { id: 't1', name: 'recs', type: 'image_only', format: 'ig-carousel' };

test('plannerPrompt: embeds runs, templates, history; enforces sparse rule', () => {
  const msgs = plannerPrompt([RUN], [TPL], ['topik lama']);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.role, 'system');
  assert.ok(msgs[0]!.content.includes('SPARINGLY'));
  assert.ok(msgs[0]!.content.includes('0-3 plans'));
  assert.ok(msgs[1]!.content.includes('2026-10-02'));
  assert.ok(msgs[1]!.content.includes('image_only'));
  assert.ok(msgs[1]!.content.includes('topik lama'));
});

test('plannerPrompt: empty history still renders', () => {
  const msgs = plannerPrompt([], [], []);
  assert.equal(msgs.length, 2);
  assert.ok(msgs[1]!.content.includes('[]'));
});

// ---------- /plan command ----------

test('parseCmd: /plan with and without slug', () => {
  assert.deepEqual(parseCmd('/plan', SLUGS), { t: 'plan', slug: undefined });
  assert.deepEqual(parseCmd('/plan default', SLUGS), { t: 'plan', slug: 'default' });
});

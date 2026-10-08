import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPillarsOut, cleanPillarSuggestions } from '../src/schema.ts';
import { pillarSuggestPrompt } from '../src/prompts.ts';

const P = (name: string, is_news = false) => ({ name, description: 'deskripsi pillar yang cukup panjang', is_news });

test('isPillarsOut: shape + bounds', () => {
  assert.ok(isPillarsOut({ pillars: [P('Tips')] }));
  assert.ok(!isPillarsOut({ pillars: [] }));
  assert.ok(!isPillarsOut({ pillars: [{ name: 'x', description: 'short', is_news: false }] }));
  assert.ok(!isPillarsOut({ pillars: [{ name: 'x', description: 'deskripsi panjang sekali', is_news: 'no' }] }));
  assert.ok(!isPillarsOut([P('Tips')]));
});

test('cleanPillarSuggestions: dedupe vs existing + within, case-insensitive, trims', () => {
  const out = cleanPillarSuggestions({ pillars: [P(' Tips '), P('Karier'), P('karier'), P('Drama Kantor')] }, [P('tips')]);
  assert.deepEqual(out.map((p) => p.name), ['Karier', 'Drama Kantor']);
});

test('cleanPillarSuggestions: max one news, none when group already has one', () => {
  assert.deepEqual(cleanPillarSuggestions({ pillars: [P('A', true), P('B', true), P('C')] }, []).map((p) => p.name), ['A', 'C']);
  assert.deepEqual(cleanPillarSuggestions({ pillars: [P('A', true), P('C')] }, [P('Berita', true)]).map((p) => p.name), ['C']);
});

test('cleanPillarSuggestions: cap 8', () => {
  const many = Array.from({ length: 10 }, (_, i) => P(`P${i}`));
  assert.equal(cleanPillarSuggestions({ pillars: many }, []).length, 8);
});

test('pillarSuggestPrompt: carries brief + existing pillars', () => {
  const m = pillarSuggestPrompt('akun untuk desainer UI pemula', [P('Tips Figma')]);
  assert.match(m[1]!.content, /desainer UI pemula/);
  assert.match(m[1]!.content, /Tips Figma/);
  assert.match(m[0]!.content, /2-5 NEW/);
});

import { isStylesOut, cleanStyleSuggestions } from '../src/schema.ts';
import { styleSuggestPrompt } from '../src/prompts.ts';

const S = (title: string, platform: 'instagram' | 'linkedin' | null = null) => ({ title, body: 'x'.repeat(60), platform });

test('isStylesOut: shape + platform enum + min body', () => {
  assert.ok(isStylesOut({ samples: [S('A', 'instagram')] }));
  assert.ok(!isStylesOut({ samples: [] }));
  assert.ok(!isStylesOut({ samples: [{ ...S('A'), platform: 'tiktok' }] }));
  assert.ok(!isStylesOut({ samples: [{ ...S('A'), body: 'short' }] }));
});

test('cleanStyleSuggestions: dedupe vs existing + within, cap 6', () => {
  assert.deepEqual(cleanStyleSuggestions({ samples: [S(' A '), S('b'), S('B')] }, [{ title: 'a' }]).map((s) => s.title), ['b']);
  assert.equal(cleanStyleSuggestions({ samples: Array.from({ length: 9 }, (_, i) => S(`T${i}`)) }, []).length, 6);
});

test('styleSuggestPrompt: carries pillars, brief, existing', () => {
  const m = styleSuggestPrompt([{ name: 'Code Review', description: 'review PR' }], 'akun junior dev', [{ title: 'Old', body: 'old body' }]);
  assert.match(m[1]!.content, /Code Review/);
  assert.match(m[1]!.content, /akun junior dev/);
  assert.match(m[1]!.content, /Old/);
  assert.doesNotMatch(styleSuggestPrompt([{ name: 'P', description: 'd' }], null, [])[1]!.content, /Account brief/);
});

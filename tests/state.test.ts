import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextSlot, forcedSlot, nextState,
  type RotationState, type PillarLite,
} from '../src/state.ts';

const P = (id: number, is_news = false): PillarLite => ({ id, is_news });
const S = (o: Partial<RotationState>): RotationState => ({
  last_platform: 'linkedin', last_ig_format: null, last_li_format: null, last_pillar_id: null, ...o,
});

test('platform selalu bergantian', () => {
  const st = S({ last_platform: 'instagram' });
  assert.equal(nextSlot(st, [P(1)], true).platform, 'linkedin');
  assert.equal(nextSlot(S({ last_platform: 'linkedin' }), [P(1)], true).platform, 'instagram');
});

test('format IG: carousel <-> reels', () => {
  assert.equal(nextSlot(S({ last_platform: 'linkedin', last_ig_format: 'carousel' }), [P(1)], true).format, 'reels');
  assert.equal(nextSlot(S({ last_platform: 'linkedin', last_ig_format: 'reels' }), [P(1)], true).format, 'carousel');
  assert.equal(nextSlot(S({ last_platform: 'linkedin', last_ig_format: null }), [P(1)], true).format, 'carousel');
});

test('format LI: text <-> pdf', () => {
  assert.equal(nextSlot(S({ last_platform: 'instagram', last_li_format: 'pdf' }), [P(1)], true).format, 'text');
  assert.equal(nextSlot(S({ last_platform: 'instagram', last_li_format: 'text' }), [P(1)], true).format, 'pdf');
  assert.equal(nextSlot(S({ last_platform: 'instagram', last_li_format: null }), [P(1)], true).format, 'pdf');
});

test('pilar bergilir mengikuti urutan, wrap ke awal', () => {
  const ps = [P(1), P(2), P(3)];
  assert.equal(nextSlot(S({ last_platform: 'linkedin', last_pillar_id: 1 }), ps, true).pillar_id, 2);
  assert.equal(nextSlot(S({ last_platform: 'linkedin', last_pillar_id: 3 }), ps, true).pillar_id, 1);
  assert.equal(nextSlot(S({ last_platform: 'linkedin', last_pillar_id: null }), ps, true).pillar_id, 1);
});

test('pilar berita dilewati saat allowNews=false, non-news tetap wrap', () => {
  const ps = [P(1), P(2, true), P(3)]; // id 2 = news
  const st = S({ last_platform: 'linkedin', last_pillar_id: 1 });
  assert.equal(nextSlot(st, ps, false).pillar_id, 3);
  assert.equal(nextSlot(S({ last_platform: 'linkedin', last_pillar_id: 3 }), ps, false).pillar_id, 1);
});

test('pilar berita dipilih saat gilirannya dan allowNews=true', () => {
  const ps = [P(1), P(2, true)];
  assert.equal(nextSlot(S({ last_platform: 'linkedin', last_pillar_id: 1 }), ps, true).pillar_id, 2);
});

test('semua pilar news + allowNews=false → fallback pilar pertama (tidak throw)', () => {
  const ps = [P(1, true), P(2, true)];
  assert.equal(nextSlot(S({ last_platform: 'linkedin' }), ps, false).pillar_id, 1);
});

test('tanpa pilar aktif → throw', () => {
  assert.throws(() => nextSlot(S({}), [], true), /no active pillars/);
});

test('forcedSlot: platform sama dgn rotasi natural → format natural', () => {
  // natural dr linkedin-last = instagram carousel
  const slot = forcedSlot(S({ last_platform: 'linkedin', last_ig_format: 'reels' }), [P(1)], true, 'instagram');
  assert.deepEqual(slot, { platform: 'instagram', format: 'carousel', pillar_id: 1 });
});

test('forcedSlot: platform beda dgn natural → format dibalik dr terakhir platform itu', () => {
  // natural = instagram, tapi paksa linkedin; last_li_format=null → pdf
  const slot = forcedSlot(S({ last_platform: 'linkedin', last_li_format: null }), [P(1)], true, 'linkedin');
  assert.deepEqual(slot, { platform: 'linkedin', format: 'pdf', pillar_id: 1 });
});

test('forcedSlot: format eksplisit menang, pilar tetap rotasi natural', () => {
  const slot = forcedSlot(S({ last_platform: 'linkedin', last_pillar_id: 1 }), [P(1), P(2)], true, 'instagram', 'reels');
  assert.deepEqual(slot, { platform: 'instagram', format: 'reels', pillar_id: 2 });
});

test('nextState: hanya format platform terkait yg berubah', () => {
  const st = S({ last_platform: 'linkedin', last_ig_format: 'carousel', last_li_format: 'text', last_pillar_id: 1 });
  const nx = nextState(st, { platform: 'instagram', format: 'reels', pillar_id: 3 });
  assert.deepEqual(nx, {
    last_platform: 'instagram', last_ig_format: 'reels', last_li_format: 'text', last_pillar_id: 3,
  });
});

test('nextState lalu nextSlot: siklus penuh konsisten dgn PRD (LI text → IG carousel → LI pdf → IG reels)', () => {
  const ps = [P(1)];
  let st = S({ last_platform: 'linkedin', last_ig_format: 'reels', last_li_format: 'text' });
  const seq: string[] = [];
  for (let i = 0; i < 4; i++) {
    const slot = nextSlot(st, ps, true);
    seq.push(`${slot.platform}:${slot.format}`);
    st = nextState(st, slot);
  }
  assert.deepEqual(seq, [
    'instagram:carousel', 'linkedin:pdf', 'instagram:reels', 'linkedin:text',
  ]);
});

test('hari terlewat tidak merusak apa pun — rotasi murni dari state', () => {
  // tidak ada input tanggal sama sekali; run 2x berturut setelah skip 5 hari = sama dgn tanpa skip
  const ps = [P(1), P(2)];
  const run2 = (st0: RotationState) => {
    let st = st0;
    const out: string[] = [];
    for (let i = 0; i < 2; i++) {
      const slot = nextSlot(st, ps, true);
      out.push(`${slot.platform}:${slot.format}:${slot.pillar_id}`);
      st = nextState(st, slot);
    }
    return out;
  };
  const st0 = S({ last_platform: 'linkedin', last_ig_format: 'carousel', last_li_format: 'pdf', last_pillar_id: 2 });
  assert.deepEqual(run2(st0), run2(st0)); // deterministik
  assert.deepEqual(run2(st0), ['instagram:reels:1', 'linkedin:text:2']);
});

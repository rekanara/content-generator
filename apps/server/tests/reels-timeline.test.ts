import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, wordsForScene, sceneAtFrame, activeWord } from '@workspace/reels/timeline';
import { parseTheme, DEFAULT_THEME } from '@workspace/reels/theme';

test('buildTimeline: contiguous scenes, frames from audio duration', () => {
  const t = buildTimeline([
    { overlay_text: 'A', narration: 'satu dua', durationSec: 2 },
    { overlay_text: 'B', narration: 'tiga', durationSec: 1.5 },
  ], 30);
  assert.equal(t.durationInFrames, 105);
  assert.deepEqual(t.scenes.map((s) => [s.startFrame, s.endFrame]), [[0, 60], [60, 105]]);
  assert.equal(sceneAtFrame(t, 59).index, 0);
  assert.equal(sceneAtFrame(t, 60).index, 1);
  assert.equal(sceneAtFrame(t, 999).index, 1);
});

test('wordsForScene: spans the scene, ordered, every word ≥1 frame', () => {
  const w = wordsForScene('a b c', 10, 40);
  assert.equal(w.length, 3);
  assert.equal(w[0]!.startFrame, 10);
  assert.equal(w.at(-1)!.endFrame, 40);
  assert.ok(w.every((x) => x.endFrame > x.startFrame));
  assert.deepEqual(wordsForScene('   ', 0, 10), []);
  assert.ok(wordsForScene('a b c d e f', 0, 2).every((x) => x.endFrame - x.startFrame >= 1));
});

test('activeWord: follows the frame', () => {
  const t = buildTimeline([{ overlay_text: 'A', narration: 'a b', durationSec: 2 }], 30);
  assert.equal(activeWord(t.scenes[0]!, 0), 0);
  assert.equal(activeWord(t.scenes[0]!, 45), 1);
});

test('parseTheme: partial → defaults filled, garbage → default theme', () => {
  const t = parseTheme({ palette: { accent: '#ff0000' }, brand: { handle: '@x' } });
  assert.equal(t.palette.accent, '#ff0000');
  assert.equal(t.palette.bg, DEFAULT_THEME.palette.bg);
  assert.equal(t.brand.handle, '@x');
  assert.deepEqual(parseTheme({ layout: 'nope' }), DEFAULT_THEME);
  assert.deepEqual(parseTheme(null), DEFAULT_THEME);
});

import { wordsFromTimings, defaultVisual } from '@workspace/reels/timeline';
import { parseWordBoundaries } from '../src/tts.ts';
import { isReelsOut, sceneVisual } from '../src/schema.ts';

test('wordsFromTimings: spoken seconds → frames, hold until next word, last holds to scene end', () => {
  const w = wordsFromTimings([{ text: 'a', start: 0.1, end: 0.4 }, { text: 'b', start: 1, end: 1.3 }], 100, 160, 30);
  assert.deepEqual(w, [
    { text: 'a', startFrame: 103, endFrame: 130 },
    { text: 'b', startFrame: 130, endFrame: 160 },
  ]);
  assert.ok(wordsFromTimings([{ text: 'late', start: 99, end: 100 }], 0, 30, 30)[0]!.startFrame < 30);
});

test('buildTimeline: spoken timings win over even spread; visual explicit or defaulted', () => {
  const t = buildTimeline([
    { overlay_text: 'Halo', narration: 'a b c', durationSec: 1, words: [{ text: 'a', start: 0, end: 0.2 }, { text: 'b', start: 0.5, end: 0.7 }] },
    { overlay_text: '3 bulan cuti', narration: 'x', durationSec: 1 },
    { overlay_text: 'Biasa', narration: 'y', durationSec: 1, visual: 'quote' },
    { overlay_text: 'Tutup', narration: 'z', durationSec: 1 },
  ], 30);
  assert.equal(t.scenes[0]!.words.length, 2);
  assert.deepEqual(t.scenes.map((s) => s.visual), ['hook', 'stat', 'quote', 'cta']);
  assert.equal(defaultVisual(0, 1, 'x'), 'hook');
  assert.equal(defaultVisual(0, 3, '5 hal'), 'hook');
  assert.equal(defaultVisual(1, 3, 'Tanpa angka'), 'point');
});

test('parseWordBoundaries: edge metadata → seconds, sorted, junk skipped', () => {
  const chunk = (off: number, dur: number, text: string) => JSON.stringify({ Metadata: [{ Type: 'WordBoundary', Data: { Offset: off, Duration: dur, text: { Text: text } } }] });
  const w = parseWordBoundaries([chunk(4500000, 1625000, 'baru'), chunk(1125000, 3375000, 'Aturan'), 'not json', JSON.stringify({ Metadata: [{ Type: 'SessionEnd' }] })]);
  assert.deepEqual(w.map((x) => x.text), ['Aturan', 'baru']);
  assert.equal(w[0]!.start, 0.1125);
  assert.ok(Math.abs(w[0]!.end - 0.45) < 1e-9);
});

test('reels scene guard: visual optional; sceneVisual drops unknown values', () => {
  const caption = { title: 't', subtitle: '', cta: '', tags: [] };
  const sc = (extra: object) => ({ caption, scenes: Array.from({ length: 4 }, () => ({ overlay_text: 'o', narration: 'n', ...extra })) });
  assert.ok(isReelsOut(sc({})));
  assert.ok(isReelsOut(sc({ visual: 'stat' })));
  assert.ok(!isReelsOut(sc({ visual: 5 })));
  assert.equal(sceneVisual('stat'), 'stat');
  assert.equal(sceneVisual('bogus'), undefined);
  assert.equal(sceneVisual(undefined), undefined);
});

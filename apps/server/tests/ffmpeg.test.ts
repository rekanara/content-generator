import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ffprobeDurationArgs, segmentArgs, concatArgs } from '../src/render/ffmpeg.ts';

test('ffprobeDurationArgs: format benar', () => {
  assert.deepEqual(ffprobeDurationArgs('a.mp3'), [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 'a.mp3',
  ]);
});

test('segmentArgs: loop PNG + audio, durasi 3 desimal, h264 yuv420p aac', () => {
  const a = segmentArgs('f.png', 'a.mp3', 5.23456, 'seg.mp4');
  const s = a.join(' ');
  assert.equal(a[a.indexOf('-t') + 1], '5.235');
  assert.ok(s.includes('scale=1080:1920'));
  assert.ok(s.includes('libx264'));
  assert.ok(s.includes('yuv420p'));
  assert.ok(s.includes('aac'));
  assert.equal(a[a.length - 1], 'seg.mp4');
});

test('concatArgs: demuxer concat, stream copy', () => {
  const a = concatArgs('list.txt', 'out.mp4');
  const s = a.join(' ');
  assert.ok(s.includes('-f concat'));
  assert.ok(s.includes('-c copy'));
  assert.equal(a[a.length - 1], 'out.mp4');
});

import { audioConcatArgs, muxArgs } from '../src/render/ffmpeg.ts';

test('audioConcatArgs: concat demuxer → aac', () => {
  const a = audioConcatArgs('a.txt', 'n.m4a');
  assert.ok(a.join(' ').includes('-f concat'));
  assert.ok(a.includes('aac'));
  assert.equal(a.at(-1), 'n.m4a');
});

test('muxArgs: copies video, maps narration, shortest + faststart', () => {
  const a = muxArgs('v.mp4', 'n.m4a', 'o.mp4');
  const s = a.join(' ');
  assert.ok(s.includes('-map 0:v:0') && s.includes('-map 1:a:0'));
  assert.ok(s.includes('-c:v copy') && s.includes('-shortest') && s.includes('+faststart'));
  assert.equal(a.at(-1), 'o.mp4');
});

import { sfxMixArgs } from '../src/render/ffmpeg.ts';

test('sfxMixArgs: no cues → stream copy; cues → delayed amix without normalize', () => {
  assert.deepEqual(sfxMixArgs('n.m4a', [], 'o.m4a'), ['-y', '-i', 'n.m4a', '-c:a', 'copy', 'o.m4a']);
  const a = sfxMixArgs('n.m4a', [{ atSec: 1.5, file: 'a.mp3', volume: 0.3 }, { atSec: 0, file: 'b.mp3', volume: 0.5 }], 'o.m4a');
  const f = a[a.indexOf('-filter_complex') + 1]!;
  assert.ok(f.includes('adelay=1500|1500,volume=0.3'));
  assert.ok(f.includes('amix=inputs=3:duration=first') && f.includes('normalize=0'));
  assert.equal(a.at(-1), 'o.m4a');
});

import { promoAudioArgs } from '../src/render/ffmpeg.ts';

test('promoAudioArgs: silent base when no narration, looped ducked BGM, trimmed to duration', () => {
  const a = promoAudioArgs({ durationSec: 10, cues: [{ atSec: 1, file: 's.mp3', volume: 0.3 }], bgm: 'b.mp3', out: 'o.m4a' });
  const s = a.join(' ');
  assert.ok(s.includes('anullsrc') && s.includes('-stream_loop -1 -i b.mp3'));
  assert.ok(s.includes('adelay=1000|1000') && s.includes('amix=inputs=3') && s.includes('normalize=0'));
  assert.equal(a[a.indexOf('-t', a.indexOf('-map')) + 1], '10.000');
  const v = promoAudioArgs({ narration: 'n.m4a', durationSec: 5, cues: [], out: 'o.m4a' }).join(' ');
  assert.ok(v.includes('-i n.m4a') && !v.includes('anullsrc') && v.includes('amix=inputs=1'));
});

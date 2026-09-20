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

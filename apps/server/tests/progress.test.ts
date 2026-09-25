// Live run progress tracker — pure in-memory single slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRun, stage, postRef, endRun, readRun } from '../src/progress.ts';

test('startRun → active run with initial slot stage', () => {
  startRun('generate', 'default');
  const r = readRun()!;
  assert.equal(r.active, true);
  assert.equal(r.kind, 'generate');
  assert.equal(r.slug, 'default');
  assert.equal(r.stage, 'slot');
  assert.equal(r.postId, null);
});

test('stage() updates stage+detail; readRun returns a copy', () => {
  startRun('generate', 'default');
  stage('writer', 'heisenbug topic');
  const r = readRun()!;
  assert.equal(r.stage, 'writer');
  assert.equal(r.detail, 'heisenbug topic');
  r.stage = 'hacked' as never;
  assert.equal(readRun()!.stage, 'writer'); // snapshot copy — live slot untouched
});

test('postRef() attaches the post id once the draft persists', () => {
  startRun('generate', 'default');
  postRef('abc-123');
  assert.equal(readRun()!.postId, 'abc-123');
});

test('endRun() success → done; explicit awaiting pause is preserved', () => {
  startRun('generate', 'default');
  stage('awaiting', 'approval');
  endRun();
  assert.equal(readRun()!.stage, 'awaiting');
  assert.equal(readRun()!.active, false);

  startRun('generate', 'default');
  stage('deliver');
  endRun();
  assert.equal(readRun()!.stage, 'done');
  assert.equal(readRun()!.active, false);
});

test('endRun(error) → failed with truncated error message', () => {
  startRun('generate', 'default');
  endRun('x'.repeat(500));
  const r = readRun()!;
  assert.equal(r.stage, 'failed');
  assert.equal(r.active, false);
  assert.equal(r.error!.length, 300);
});

test('setters are no-ops when no run was started (direct CLI path)', () => {
  // note: module state is shared across tests in one file — the last run ended
  // inactive, but setters must not resurrect anything
  const before = readRun();
  stage('writer'); postRef('zzz'); endRun();
  const after = readRun();
  assert.deepEqual(after, before);
});

test('endRun is idempotent — a second call never rewrites the final state', () => {
  startRun('approve', 'default');
  stage('deliver');
  endRun();
  endRun('a late error must not overwrite the outcome'); // e.g. double-fired catch
  const r = readRun()!;
  assert.equal(r.stage, 'done');
  assert.equal(r.error, null);
});

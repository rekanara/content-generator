// Caption assembly + guard (pure) — structured caption → final string.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleCaption, isCaptionOut, toCaptionOut, type CaptionOut } from '../src/schema.ts';

const C = (o: Partial<CaptionOut> = {}): CaptionOut => ({
  title: 'Debug 30 Menit yang Mengubah Karier', subtitle: '', cta: '', tags: [], ...o,
});

// ---------- isCaptionOut ----------

test('isCaptionOut: full shape', () => {
  assert.equal(isCaptionOut({ title: 'T', subtitle: 'S', cta: 'C', tags: ['#dev'] }), true);
});

test('isCaptionOut: optional parts may be empty strings; tags may be empty', () => {
  assert.equal(isCaptionOut({ title: 'T', subtitle: '', cta: '', tags: [] }), true);
});

test('isCaptionOut: rejects bad shapes', () => {
  assert.equal(isCaptionOut(null), false);
  assert.equal(isCaptionOut({ title: '', subtitle: '', cta: '', tags: [] }), false); // empty title
  assert.equal(isCaptionOut({ title: 'T', subtitle: 5, cta: '', tags: [] }), false);
  assert.equal(isCaptionOut({ title: 'T', subtitle: '', cta: '', tags: 'nope' }), false);
  assert.equal(isCaptionOut({ title: 'T', subtitle: '', cta: '', tags: ['#a', ''] }), false); // empty tag
  assert.equal(isCaptionOut({ title: 'T', subtitle: '', cta: '', tags: Array(9).fill('#x') }), false); // > 8
});

// ---------- assembleCaption ----------

test('assembleCaption: full order — title, subtitle, cta, footer, tags', () => {
  const out = assembleCaption(
    { title: 'Judul', subtitle: 'Sub isi', cta: 'Simpan ini', tags: ['#dev', '#tips'] },
    '— @jack tiap hari',
  );
  assert.equal(out, 'Judul\n\nSub isi\n\nSimpan ini\n\n— @jack tiap hari\n\n#dev #tips');
});

test('assembleCaption: empty parts skipped — no blank gaps', () => {
  const out = assembleCaption(C({ title: 'Judul' }), '');
  assert.equal(out, 'Judul');
  const withTags = assembleCaption(C({ title: 'Judul', tags: ['#x'] }), '');
  assert.equal(withTags, 'Judul\n\n#x');
});

test('assembleCaption: footer omitted when blank', () => {
  const withFooter = assembleCaption(C({ title: 'J', subtitle: 'S' }), 'footer');
  const without = assembleCaption(C({ title: 'J', subtitle: 'S' }), '');
  assert.equal(withFooter, 'J\n\nS\n\nfooter');
  assert.equal(without, 'J\n\nS');
});

test('assembleCaption: tags normalized — # guaranteed once, whitespace tags dropped, deduped', () => {
  const out = assembleCaption(C({ title: 'J', tags: ['dev', '##tips', '  ', 'has space', 'dev'] }), '');
  assert.equal(out, 'J\n\n#dev #tips');
});

test('assembleCaption: title-only with everything else empty', () => {
  assert.equal(assembleCaption(C(), ''), 'Debug 30 Menit yang Mengubah Karier');
});

// ---------- cta override ----------

test('assembleCaption: ctaOverride replaces the LLM cta when set', () => {
  const out = assembleCaption(
    { title: 'T', subtitle: 'S', cta: 'LLM cta', tags: [] },
    '', 'Follow @jack untuk tips harian',
  );
  assert.equal(out, 'T\n\nS\n\nFollow @jack untuk tips harian');
});

test('assembleCaption: blank/whitespace ctaOverride falls back to the LLM cta', () => {
  assert.equal(assembleCaption({ title: 'T', subtitle: 'S', cta: 'LLM cta', tags: [] }, '', '').includes('LLM cta'), true);
  assert.equal(assembleCaption({ title: 'T', subtitle: 'S', cta: 'LLM cta', tags: [] }, '', '   ').includes('LLM cta'), true);
});

test('assembleCaption: override wins even when LLM cta is empty', () => {
  const out = assembleCaption({ title: 'T', subtitle: '', cta: '', tags: [] }, '', 'Klik follow');
  assert.equal(out, 'T\n\nKlik follow');
});

// ---------- tolerant caption guard (string shape from some models) ----------

test('isCaptionOut: plain string accepted (old shape tolerated)', () => {
  assert.equal(isCaptionOut('judul sebagai string'), true);
  assert.equal(isCaptionOut(''), false); // empty string still rejected
});

test('toCaptionOut: string → structured {title}', () => {
  assert.deepEqual(toCaptionOut('Judul string'), { title: 'Judul string', subtitle: '', cta: '', tags: [] });
  assert.deepEqual(toCaptionOut({ title: 'T', subtitle: 'S', cta: 'C', tags: ['#x'] }), { title: 'T', subtitle: 'S', cta: 'C', tags: ['#x'] });
});

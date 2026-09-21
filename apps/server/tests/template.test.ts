// Pure render-template logic: buildSlides package sequencing (body/cover/CTA) + cover policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlides, isManualCoverMode, imageMime } from '../src/render/template.ts';
import { imagePrompt } from '../src/prompts.ts';
import type { CarouselOut } from '../src/schema.ts';

const DRAFT: CarouselOut = {
  caption: 'cap',
  slides: [
    { headline: 'Cover <Hook>', body: 'first body' },
    { headline: 'Mid', body: 'mid body' },
    { headline: 'CTA & Follow', body: 'last body' },
  ],
};

const T = {
  body: '<body>BODY {{headline}} {{body}} {{index}}/{{total}}</body>',
  first: '<body>FIRST {{image}} {{headline}}</body>',
  last: '<body>LAST {{headline}}</body>',
};

test('buildSlides: no first/last templates → all body (backward compat)', () => {
  const htmls = buildSlides({ body: T.body }, DRAFT);
  assert.equal(htmls.length, 3);
  assert.ok(htmls.every((h) => h.startsWith('<body>BODY')));
  assert.equal(htmls[0], '<body>BODY Cover &lt;Hook&gt; first body 1/3</body>');
});

test('buildSlides: first+last with cover → package sequence applied', () => {
  const cover = Buffer.from('fakepng');
  const htmls = buildSlides(T, DRAFT, cover);
  assert.ok(htmls[0]!.startsWith('<body>FIRST data:image/png;base64,'));
  assert.ok(htmls[0]!.includes('Cover &lt;Hook&gt;'));
  assert.ok(htmls[1]!.startsWith('<body>BODY'));
  assert.equal(htmls[2], '<body>LAST CTA &amp; Follow</body>');
});

test('buildSlides: first template WITHOUT cover image → falls back to body (fail-safe)', () => {
  const htmls = buildSlides(T, DRAFT);
  assert.ok(htmls[0]!.startsWith('<body>BODY')); // no broken cover page without its image
  assert.equal(htmls[2], '<body>LAST CTA &amp; Follow</body>'); // last has no image dependency
});

test('buildSlides: single-slide post never gets the last template as slide 1', () => {
  const one: CarouselOut = { caption: '', slides: [{ headline: 'Only', body: 'x' }] };
  const htmls = buildSlides(T, one, Buffer.from('p'));
  assert.ok(htmls[0]!.startsWith('<body>FIRST')); // first wins on slide 1; last skipped (total < 2)
});

test('buildSlides: data URI is not HTML-escaped (raw pass-through)', () => {
  const htmls = buildSlides(T, DRAFT, Buffer.from('ab'));
  assert.ok(htmls[0]!.includes('data:image/png;base64,YWI='));
});

test('imagePrompt: mentions headline, forbids text, deterministic', () => {
  const p1 = imagePrompt('Refactor');
  const p2 = imagePrompt('Refactor');
  assert.equal(p1, p2);
  assert.ok(p1.includes('"Refactor"'));
  assert.ok(/no text/i.test(p1));
});

// ---------- cover policy (pure) ----------

test('isManualCoverMode: blank/empty → manual (ask for Telegram upload)', () => {
  assert.equal(isManualCoverMode(''), true);
  assert.equal(isManualCoverMode('   '), true);
  assert.equal(isManualCoverMode('empty'), true);
  assert.equal(isManualCoverMode('EMPTY'), true);
  assert.equal(isManualCoverMode(' Empty '), true);
});

test('isManualCoverMode: model name → auto-generate', () => {
  assert.equal(isManualCoverMode('dall-e-3'), false);
  assert.equal(isManualCoverMode('openrouter/google/gemini-2.5-flash-image'), false);
});

test('imageMime: JPEG magic (Telegram photos) vs everything-else → PNG', () => {
  assert.equal(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])), 'image/jpeg');
  assert.equal(imageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])), 'image/png'); // PNG magic
  assert.equal(imageMime(Buffer.from('ab')), 'image/png'); // unknown → png default
});

test('buildSlides: JPEG cover gets the correct data-URI mime', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const htmls = buildSlides(T, DRAFT, jpeg);
  assert.ok(htmls[0]!.startsWith('<body>FIRST data:image/jpeg;base64,'));
});

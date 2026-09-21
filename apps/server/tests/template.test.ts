// Pure render-template logic: buildSlides kind sequencing + imagePrompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlides } from '../src/render/template.ts';
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

test('buildSlides: first+last with cover → kind sequence applied', () => {
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

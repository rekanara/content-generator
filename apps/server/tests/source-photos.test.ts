import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImageUrls, imageSize } from '../src/article.ts';
import { buildSlides } from '../src/render/template.ts';

const BASE = 'https://news.example.com/a/b';

test('extractImageUrls: og:image first, article imgs after, junk + small + svg dropped, absolute + deduped', () => {
  const html = `<head><meta property="og:image" content="/img/lead.jpg"></head>
  <body><img src="/logo.png"><article>
    <img src="/img/lead.jpg">
    <img src="/icons/share.png">
    <img src="/img/tiny.jpg" width="120" height="80">
    <img src="/img/chart.svg">
    <img data-src="https://cdn.example.com/p2.jpg">
    <img srcset="/img/p3-480.jpg 480w, /img/p3-1200.jpg 1200w" src="/img/p3-480.jpg">
  </article></body>`;
  assert.deepEqual(extractImageUrls(html, BASE), [
    'https://news.example.com/img/lead.jpg',
    'https://cdn.example.com/p2.jpg',
    'https://news.example.com/img/p3-1200.jpg',
  ]);
});

test('extractImageUrls: no article/main → og only; cap respected', () => {
  assert.deepEqual(extractImageUrls('<img src="/x.jpg">', BASE), []);
  const many = `<article>${Array.from({ length: 9 }, (_, i) => `<img src="/p${i}.jpg">`).join('')}</article>`;
  assert.equal(extractImageUrls(many, BASE, 5).length, 5);
});

test('imageSize: PNG + JPEG headers, garbage → null', () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(1200, 16); png.writeUInt32BE(800, 20);
  assert.deepEqual(imageSize(png), { w: 1200, h: 800 });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x04, 0x38, 0x03]);
  assert.deepEqual(imageSize(jpg), { w: 1080, h: 600 });
  assert.equal(imageSize(Buffer.from('nope')), null);
});

test('photoPlan: photos after the lead go to body slides 2..n-1 only', async () => {
  const { photoPlan } = await import('../src/pipeline.ts');
  assert.deepEqual(photoPlan(5, 6), [2, 3, 4, 5]);
  assert.deepEqual(photoPlan(3, 8), [2, 3]);
  assert.deepEqual(photoPlan(1, 8), []);
  assert.deepEqual(photoPlan(5, 2), []);
});

test('buildSlides: photo auto-injected with credit; cover page gets credit badge only', () => {
  const d = { slides: [
    { headline: 'A', body: 'a', photo_credit: 'Foto: kompas.com' },
    { headline: 'B', body: 'b', photo_uri: 'data:image/jpeg;base64,AAA', photo_credit: 'Foto: kompas.com' },
    { headline: 'C', body: 'c' },
  ] };
  const [cover, mid, last] = buildSlides({ body: '<body>{{headline}}</body>', first: '<body>{{image}}</body>' }, d, Buffer.from('x'));
  assert.match(cover!, /cg-credit[^>]*>Foto: kompas\.com/);
  assert.ok(!cover!.includes('cg-photo'));
  assert.match(mid!, /class="cg-photo"[\s\S]*src="data:image\/jpeg;base64,AAA"[\s\S]*Foto: kompas\.com/);
  assert.match(mid!, /padding-top:560px/);
  assert.ok(!last!.includes('cg-photo') && !last!.includes('cg-credit'));
});

test('buildSlides: explicit {{photo}} token — no auto panel, no padding override', () => {
  const [h] = buildSlides({ body: '<body><img src="{{photo}}">{{photo_credit}}</body>' }, { slides: [{ headline: 'A', body: 'a', photo_uri: 'data:image/png;base64,Q', photo_credit: 'Foto: x.id' }] });
  assert.equal(h, '<body><img src="data:image/png;base64,Q">Foto: x.id</body>');
});

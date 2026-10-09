import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImageUrls, imageSize } from '../src/article.ts';
import { buildSlides, sourcePhotoPlan } from '../src/render/template.ts';

test('sourcePhotoPlan: cover rules', () => {
  assert.deepEqual(sourcePhotoPlan(4, true, true), [[1, 2], [2, 3]]);
  assert.deepEqual(sourcePhotoPlan(4, true, false), [[1, 1], [2, 2]]);
  assert.deepEqual(sourcePhotoPlan(4, false, false), [[0, 1], [1, 2], [2, 3]]);
});

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

test('buildSlides: body photo only via template token; no token → untouched layout', () => {
  const d = { slides: [
    { headline: 'A', body: 'a', photo_credit: 'Foto: kompas.com' },
    { headline: 'B', body: 'b', photo_uri: 'data:image/jpeg;base64,AAA', photo_credit: 'Foto: kompas.com' },
    { headline: 'C', body: 'c' },
  ] };
  const [cover, mid, last] = buildSlides({ body: '<body><img src="{{image}}">{{headline}}</body>', first: '<body>{{image}}</body>' }, d, Buffer.from('x'));
  assert.match(cover!, /cg-credit[^>]*>Foto: kompas\.com/);
  assert.match(mid!, /src="data:image\/jpeg;base64,AAA"[\s\S]*cg-credit[^>]*>Foto: kompas\.com/);
  assert.ok(!mid!.includes('cg-photo') && !mid!.includes('padding-top'));
  assert.ok(!last!.includes('cg-credit'));
  const [plain] = buildSlides({ body: '<body>{{headline}}</body>' }, { slides: [d.slides[1]!] });
  assert.equal(plain, '<body>B</body>');
});

test('buildSlides: explicit {{photo}} token — no auto panel, no padding override', () => {
  const [h] = buildSlides({ body: '<body><img src="{{photo}}">{{photo_credit}}</body>' }, { slides: [{ headline: 'A', body: 'a', photo_uri: 'data:image/png;base64,Q', photo_credit: 'Foto: x.id' }] });
  assert.equal(h, '<body><img src="data:image/png;base64,Q">Foto: x.id</body>');
});

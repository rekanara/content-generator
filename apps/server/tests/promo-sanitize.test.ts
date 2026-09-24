// Promo fragment sanitizer + template palette — the template owns the canvas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePromoFragment, templatePaletteOf, promoVocabOf, cssVocabOf } from '../src/render/promotion.ts';

test('sanitize: strips background + font-family from the ROOT style, keeps the rest', () => {
  const dirty = `<div style='width:100%;height:100%;background:#0a0a12;display:flex;flex-direction:column;font-family:sans-serif;padding:48px;'>hi</div>`;
  const clean = sanitizePromoFragment(dirty);
  assert.ok(!/background/i.test(clean.split('>')[0]!), 'root background must be gone');
  assert.ok(!/font-family/i.test(clean.split('>')[0]!), 'root font-family must be gone');
  assert.ok(clean.includes('width:100%') && clean.includes('display:flex') && clean.includes('padding:48px'), 'other root decls survive');
});

test('sanitize: gradient background-image on the root is stripped too', () => {
  const dirty = `<div style="background-image:linear-gradient(135deg,#7c5cff,#4a2fd6);color:#fff;">x</div>`;
  const clean = sanitizePromoFragment(dirty);
  assert.ok(!/background-image/i.test(clean));
  assert.ok(clean.includes('color:#fff'));
});

test('sanitize: CHILD styles are untouched (cards, chips, image overlays are content)', () => {
  const dirty = `<div style='display:flex;'><div style='background:#15152a;border-radius:12px;'>card</div><div style='background:linear-gradient(90deg,#000,transparent)'></div></div>`;
  const clean = sanitizePromoFragment(dirty);
  assert.ok(clean.includes('background:#15152a'), 'child card bg survives');
  assert.ok(clean.includes('linear-gradient(90deg,#000,transparent)'), 'child overlay gradient survives');
});

test('sanitize: root without a style attr → unchanged; no tags → unchanged', () => {
  const a = `<div><span style='background:#111'>x</span></div>`;
  assert.equal(sanitizePromoFragment(a), a, 'root has no style — child style must NOT be stripped');
  assert.equal(sanitizePromoFragment('just text'), 'just text');
  assert.equal(sanitizePromoFragment(''), '');
});

test('palette: custom props first, hexes deduped, canvas colors dropped', () => {
  const tpl = `<style>:root{--bg:#0A0C10;--accent:#FF5757;--text-secondary:#8B93A3}
  .x{color:#ff5757;background:#0a0c10;border-color:#8b93a3}</style>`;
  const pal = templatePaletteOf(tpl);
  assert.ok(pal[0]!.startsWith('--'), 'custom props lead');
  assert.ok(pal.includes('--accent') && pal.includes('--bg'));
  assert.ok(!pal.includes('#0a0c10'), 'canvas color dropped');
  assert.equal(pal.filter((c) => c === '#ff5757').length, 1, 'hex deduped');
});

test('vocab: composes classes + palette line', () => {
  const tpl = `<style>.feature-item{color:#ff5757}</style>`;
  const v = promoVocabOf(tpl);
  assert.ok(v.includes('.feature-item'));
  assert.ok(v.includes('Template palette'));
  assert.ok(v.includes('#ff5757'));
});

test('cssVocabOf fallback no longer invites inline-only styling', () => {
  assert.equal(cssVocabOf(''), '(no custom classes)');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPromoVideoOut } from '../src/schema.ts';
import { promoVideoPrompt, promoVideoCriticPrompt, PROMO_ARCS, type PromoData } from '../src/prompts.ts';
import { silentSceneSeconds } from '../src/render/promotion-video.ts';

const DATA: PromoData = { name: 'Audit Code', topic: 't', features: ['audit cepat'], stacks: [], stats: [], price: 'Rp 1jt', price_sale: '' };
const scene = (o: string) => ({ overlay_text: o, narration: '' });

test('isPromoVideoOut: 4-7 scenes, text fields required, visual enum', () => {
  assert.ok(isPromoVideoOut({ scenes: [{ ...scene('a'), image_query: 'developer laptop code' }, scene('b'), scene('c'), scene('d')] }));
  assert.ok(!isPromoVideoOut({ scenes: [scene('a'), scene('b')] }));
  assert.ok(!isPromoVideoOut({ scenes: Array.from({ length: 8 }, () => scene('a')) }));
  assert.ok(!isPromoVideoOut({ scenes: [scene('a'), scene('b'), scene('c'), { overlay_text: 'x', narration: '', visual: 'nope' }] }));
});

test('video prompts: silent forbids narration, voice limits it; critic carries score contract', () => {
  assert.match(promoVideoPrompt(DATA, PROMO_ARCS[0]!, 'silent')[0]!.content, /NO voiceover/);
  assert.match(promoVideoPrompt(DATA, PROMO_ARCS[0]!, 'voice')[0]!.content, /MAX 14 words/);
  assert.match(promoVideoPrompt(DATA, PROMO_ARCS[0]!, 'voice')[1]!.content, /image_query/);
  assert.match(promoVideoPrompt(DATA, PROMO_ARCS[0]!, 'voice', 'weak hook')[1]!.content, /weak hook/);
  assert.match(promoVideoCriticPrompt(DATA, 'silent', { scenes: [scene('a')] })[1]!.content, /"score"/);
});

test('silentSceneSeconds: stat/cta get more time, long overlay gets more, capped', () => {
  assert.ok(silentSceneSeconds('stat', '99 persen') > silentSceneSeconds('point', 'a b'));
  assert.ok(silentSceneSeconds('point', 'satu dua tiga empat lima enam tujuh delapan sembilan sepuluh') > silentSceneSeconds('point', 'satu dua'));
  assert.ok(silentSceneSeconds('cta', Array(40).fill('x').join(' ')) <= 5.5);
});

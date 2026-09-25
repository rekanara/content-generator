// Promo content prompt — creative arc pool + builder contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promoContentPrompt, PROMO_ARCS, type PromoData } from '../src/prompts.ts';

const DATA: PromoData = {
  name: 'Audit Code', topic: 'jasa audit & refactor', features: ['audit cepat', 'laporan jelas'],
  stacks: ['typescript', 'postgres'], stats: ['10+ proyek'], price: 'Rp 1.5jt', price_sale: 'Rp 1jt',
};

test('arc pool: non-empty, distinct, none contains the banned formula flow', () => {
  assert.ok(PROMO_ARCS.length >= 6);
  assert.equal(new Set(PROMO_ARCS).size, PROMO_ARCS.length);
  for (const arc of PROMO_ARCS) {
    assert.ok(arc.length > 40, `arc too short: ${arc}`);
    assert.ok(!/cover.*pain.*feature.*stack.*price.*proof/i.test(arc), 'arc must not encode the formula flow');
  }
});

test('builder: arc override is embedded verbatim in the user message', () => {
  const arc = 'CUSTOM ARC: open with a test directive marker 12345';
  const msgs = promoContentPrompt(DATA, '.feature-item, .stack-item', arc);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0]!.role, 'system');
  assert.equal(msgs[1]!.role, 'user');
  assert.ok(msgs[1]!.content.includes('CUSTOM ARC: open with a test directive marker 12345'));
});

test('builder: random draw lands inside the pool', () => {
  for (let i = 0; i < 20; i++) {
    const msgs = promoContentPrompt(DATA, '.a');
    const used = PROMO_ARCS.find((a) => msgs[1]!.content.includes(a));
    assert.ok(used, 'prompt must carry one of the pool arcs');
  }
});

test('builder: css vocabulary + data + JSON contract present', () => {
  const msgs = promoContentPrompt(DATA, '.feature-item, .stack-item', PROMO_ARCS[0]!);
  const [sys, usr] = [msgs[0]!.content, msgs[1]!.content];
  assert.ok(usr.includes('.feature-item') && usr.includes('.stack-item'));
  assert.ok(usr.includes('"Audit Code"'));
  assert.ok(sys.includes('{{image}}'));
  assert.ok(sys.includes('Reply ONLY with valid JSON'));
  assert.ok(sys.includes('COMPOSITION MUST VARY'));
});

test('builder: system prompt bans the generic cover phrasing', () => {
  const sys = promoContentPrompt(DATA, '.a', PROMO_ARCS[1]!)[0]!.content;
  assert.match(sys, /Introducing X/); // the ban references it explicitly
  assert.match(sys, /scroll-stopper/);
});

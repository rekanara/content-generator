// Cost catalog + usage snapshot math (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOfTokens, stepUsage, postUsage, modelPrice, imagePrice } from '../src/llm-costs.ts';

test('costOfTokens: known model — prompt + completion math', () => {
  // dattio/glm-5.3-mod: 0.6 / 2.2 per 1M
  const c = costOfTokens('dattio/glm-5.3-mod', 1_000_000, 1_000_000);
  assert.equal(Math.round(c * 100) / 100, 2.8);
  // 1k prompt + 2k completion of the same model
  const small = costOfTokens('dattio/glm-5.3-mod', 1000, 2000);
  assert.ok(Math.abs(small - (0.0006 + 0.0044)) < 1e-9);
});

test('costOfTokens: unknown model uses fallback (no throw)', () => {
  const c = costOfTokens('brand-new-model', 1_000_000, 1_000_000);
  assert.equal(Math.round(c * 100) / 100, 6); // 1 + 5 fallback
});

test('modelPrice: returns entry or fallback without mutating', () => {
  assert.equal(modelPrice('ag/claude-sonnet-4-6').completion, 15);
  assert.ok(modelPrice('never-seen').prompt > 0);
});

test('stepUsage: snapshot shape + rounding', () => {
  const s = stepUsage('dattio/glm-5.3-mod', 500_000, 500_000);
  assert.equal(s.model, 'dattio/glm-5.3-mod');
  assert.equal(s.cost, 1.4);
  assert.equal(s.prompt, 500_000);
});

test('postUsage: total = steps + cover; cover only model+cost', () => {
  const steps = { writer: stepUsage('dattio/glm-5.3-mod', 1_000_000, 0) }; // 0.6
  const u = postUsage(steps, { model: 'x-img', images: 1, cost: 0.05 });
  assert.equal(u.totalCost, 0.65);
  assert.equal(u.cover?.model, 'x-img');
  assert.equal(postUsage(steps).totalCost, 0.6);
});

test('imagePrice: catalog + fallback', () => {
  assert.equal(imagePrice('openrouter/google/gemini-2.5-flash-image').perImage, 0.039);
  assert.ok(imagePrice('unknown-img').perImage > 0);
});

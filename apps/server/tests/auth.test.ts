// Auth unit test: scrypt hash/verify (no DB — pure function).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth/password.ts';

test('hashPassword: scrypt$N$r$p$salt$key format + verify round-trip', async () => {
  const h = await hashPassword('correct horse battery staple');
  assert.match(h, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(await verifyPassword('correct horse battery staple', h), true);
});

test('verifyPassword: wrong password → false', async () => {
  const h = await hashPassword('right');
  assert.equal(await verifyPassword('wrong', h), false);
});

test('verifyPassword: corrupt/unknown hash format → false (not throw)', async () => {
  const h = await hashPassword('x'.repeat(16));
  assert.equal(await verifyPassword('x'.repeat(16), h), true);
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
  assert.equal(await verifyPassword('anything', ''), false);
  assert.equal(await verifyPassword('anything', 'plaintext$without$fields'), false);
});

test('hashPassword: random salt → two hashes differ for same password', async () => {
  const a = await hashPassword('same');
  const b = await hashPassword('same');
  assert.notEqual(a, b);
});

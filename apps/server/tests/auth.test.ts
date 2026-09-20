// Auth unit test: scrypt hash/verify (tanpa DB — pure function).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/auth.ts';

test('hashPassword: format scrypt$N$r$p$salt$key + verify round-trip', async () => {
  const h = await hashPassword('correct horse battery staple');
  assert.match(h, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(await verifyPassword('correct horse battery staple', h), true);
});

test('verifyPassword: password salah → false', async () => {
  const h = await hashPassword('right');
  assert.equal(await verifyPassword('wrong', h), false);
});

test('verifyPassword: hash korup/format tak dikenal → false (bukan throw)', async () => {
  const h = await hashPassword('x'.repeat(16));
  assert.equal(await verifyPassword('x'.repeat(16), h), true);
  assert.equal(await verifyPassword('apapun', 'bukan-hash'), false);
  assert.equal(await verifyPassword('apapun', ''), false);
  assert.equal(await verifyPassword('apapun', 'plaintext$tanpa$fields'), false);
});

test('hashPassword: salt random → dua hash beda utk password sama', async () => {
  const a = await hashPassword('sama');
  const b = await hashPassword('sama');
  assert.notEqual(a, b);
});

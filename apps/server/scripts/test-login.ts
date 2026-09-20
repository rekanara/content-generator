import { login } from '../src/auth/users.ts';
try {
  const u = await login('local', 'admin', '6661');
  console.log('OK:', u);
} catch (e) {
  console.error('ERR:', e);
}
process.exit(0);

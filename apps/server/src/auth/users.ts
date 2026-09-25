// User repository + login use case.
import { sql } from '../db/pool.ts';
import { hashPassword, verifyPassword, DUMMY_HASH } from './password.ts';
import { loginBlocked, loginFail, loginClear } from './rate-limit.ts';
import { purgeExpiredSessions } from './session.ts';
import type { AuthUser } from './session.ts';

export type UserRow = { id: string; username: string; role: 'admin' | 'user' };
export type { AuthUser };

export class LoginError extends Error {
  status: number;
  constructor(msg: string, status: number = 401) { super(msg); this.status = status; }
}

export async function login(ip: string, username: string, password: string): Promise<AuthUser> {
  const wait = loginBlocked(ip);
  if (wait > 0) throw new LoginError(`too many attempts — try again in ${wait}s`, 429);
  const [row] = await sql`select id, username, password_hash, role from users where username = ${username}`;
  // anti-enumeration: always hash-compare (dummy if user missing), ~constant time
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) {
    loginFail(ip);
    throw new LoginError('wrong username or password');
  }
  loginClear(ip);
  await purgeExpiredSessions();
  return { id: row.id as string, username: row.username as string, role: row.role as 'admin' | 'user' };
}

export async function createUser(username: string, password: string, role: 'admin' | 'user'): Promise<UserRow> {
  const hash = await hashPassword(password);
  const [row] = await sql`insert into users (username, password_hash, role)
    values (${username}, ${hash}, ${role}) returning id, username, role`;
  return { id: row!.id as string, username: row!.username as string, role: row!.role as 'admin' | 'user' };
}

export async function resetPassword(username: string, password: string): Promise<boolean> {
  const hash = await hashPassword(password);
  const r = await sql`update users set password_hash = ${hash} where username = ${username} returning id`;
  return r.length > 0;
}

export async function listUsers(): Promise<UserRow[]> {
  const rows = await sql`select id, username, role from users order by id`;
  return rows.map((r) => ({ id: r.id as string, username: r.username as string, role: r.role as 'admin' | 'user' }));
}

export async function deleteUser(id: string): Promise<{ ok: boolean; reason?: string }> {
  const [row] = await sql`select id, role from users where id = ${id}`;
  if (!row) return { ok: false, reason: 'user not found' };
  const admins = await sql<{ n: number }[]>`select count(*)::int as n from users where role = 'admin'`;
  if (row.role === 'admin' && (admins[0]?.n ?? 0) <= 1) return { ok: false, reason: 'cannot delete the last admin' };
  await sql`delete from sessions where user_id = ${id}`;
  await sql`delete from users where id = ${id}`;
  return { ok: true };
}

// after deleteUser: group-user orphan (user_id null) — managed by admin.

export async function getUser(id: string): Promise<UserRow | null> {
  const [row] = await sql`select id, username, role from users where id = ${id}`;
  return row ? { id: row.id as string, username: row.username as string, role: row.role as 'admin' | 'user' } : null;
}

// Auth: scrypt password + server-side session (DB sha256(token)) + login rate limiting.
// All stdlib node:crypto. 32-byte random token in the cookie, DB stores only its hash.
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { sql } from './db.ts';

const scryptAsync = promisify(scrypt) as (p: string | Buffer, s: Buffer, k: number, o: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, KEYLEN: 32 };

export type UserRow = { id: string; username: string; role: 'admin' | 'user' };
export type AuthUser = { id: string; username: string; role: 'admin' | 'user' };

// ---------- password ----------
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, SCRYPT.KEYLEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = stored.split('$');
    if (scheme !== 'scrypt' || !N || !r || !p || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltHex, 'hex'), expected.length, { N: +N, r: +r, p: +p });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------- session ----------
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;   // 30 days
const SLIDING_WINDOW_MS = 24 * 3600 * 1000;     // re-issue cookie at most once a day
export const SESSION_COOKIE = 'cg_session';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await sql`insert into sessions (user_id, token_hash, expires_at)
    values (${userId}, ${sha256(token)}, ${expiresAt})`;
  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const [row] = await sql`select s.id as session_id, s.expires_at, s.last_seen_at,
      u.id, u.username, u.role
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha256(token)}`;
  if (!row) return null;
  if (new Date(row.expires_at as string) < new Date()) {
    await sql`delete from sessions where id = ${row.session_id}`;
    return null;
  }
  return { id: row.id as string, username: row.username as string, role: row.role as 'admin' | 'user' };
}

// Sliding: extend session + re-issue cookie if > 1 day since last_seen.
// Returns new expires_at for the cookie, or null = no re-issue needed.
export async function touchSession(token: string, user: AuthUser): Promise<Date | null> {
  const [row] = await sql`select id, last_seen_at, expires_at from sessions where token_hash = ${sha256(token)}`;
  if (!row) return null;
  const now = new Date();
  if (now.getTime() - new Date(row.last_seen_at as string).getTime() < SLIDING_WINDOW_MS) return null;
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await sql`update sessions set last_seen_at = ${now}, expires_at = ${expiresAt} where id = ${row.id}`;
  return expiresAt;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await sql`delete from sessions where token_hash = ${sha256(token)}`;
}

// purge expired sessions — called from login (piggyback, no cron).
export async function purgeExpiredSessions(): Promise<void> {
  await sql`delete from sessions where expires_at < now()`;
}

// ---------- login rate limit (in-memory, per IP) ----------
// 5 failures / 15 min / IP → 15 min lockout. Resets on successful login.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
type Bucket = { fails: number; windowStart: number; lockedUntil: number };
const buckets = new Map<string, Bucket>();

export function loginBlocked(ip: string): number {
  const b = buckets.get(ip);
  if (!b) return 0;
  if (b.lockedUntil > Date.now()) return Math.ceil((b.lockedUntil - Date.now()) / 1000);
  if (Date.now() - b.windowStart > WINDOW_MS && b.lockedUntil < Date.now()) buckets.delete(ip);
  return 0;
}

function loginFail(ip: string): void {
  const now = Date.now();
  const b = buckets.get(ip) ?? { fails: 0, windowStart: now, lockedUntil: 0 };
  if (now - b.windowStart > WINDOW_MS) { b.fails = 0; b.windowStart = now; }
  b.fails++;
  if (b.fails >= MAX_FAILS) b.lockedUntil = now + WINDOW_MS;
  buckets.set(ip, b);
}

// ---------- login ----------
const DUMMY_HASH = 'scrypt$16384$8$1$' + '00'.repeat(16) + '$' + '00'.repeat(32);
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
  buckets.delete(ip);
  await purgeExpiredSessions();
  return { id: row.id as string, username: row.username as string, role: row.role as 'admin' | 'user' };
}

// ---------- user management (CLI / admin) ----------
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

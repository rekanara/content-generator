// Server-side sessions: 32-byte random token in cookie, DB stores only sha256(token).
import { randomBytes, createHash } from 'node:crypto';
import { sql } from '../db/pool.ts';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;   // 30 days
const SLIDING_WINDOW_MS = 24 * 3600 * 1000;     // re-issue cookie at most once a day
export const SESSION_COOKIE = 'cg_session';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export type AuthUser = { id: string; username: string; role: 'admin' | 'user' };

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

export async function revokeUserSessions(userId: string): Promise<void> {
  await sql`delete from sessions where user_id = ${userId}`;
}

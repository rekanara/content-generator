// Auth barrel — keeps existing `from './auth.ts'` imports working after the split.
export {
  SESSION_COOKIE, createSession, getSessionUser, touchSession,
  destroySession, purgeExpiredSessions, revokeUserSessions,
} from './session.ts';
export type { AuthUser } from './session.ts';
export { hashPassword, verifyPassword } from './password.ts';
export { LoginError, login, createUser, resetPassword, listUsers, deleteUser, getUser } from './users.ts';
export type { UserRow } from './users.ts';

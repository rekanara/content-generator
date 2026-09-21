// JSON API for the SPA frontend — zod-validated via @workspace/shared.
// Transport layer only: auth/cookies, validation, status codes. Logic lives in repos/usecases.
// Two parts: /groups (multi-account CRUD) + /g/:slug/... (all resources scoped to a group).
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { enqueue, queueStatus } from './queue.ts';
import { refreshCron, cronStatus } from './cron.ts';
import { getDashboard } from './usecases/dashboard.ts';
import { getCalendar } from './usecases/calendar.ts';
import {
  PillarInput, CronInput, StyleInput, TemplateInput, GenerateInput,
  GroupInput, GroupPatch,
} from '@workspace/shared';
import {
  listGroups, listGroupsForUser, getGroupRow, createGroup, patchGroup, deleteGroup, groupOut,
  getGroupOwner, saveCron,
} from './groups.ts';
import { listPillars, createPillar, togglePillar, deletePillar } from './repos/pillars.ts';
import { listPosts, getPost, rejectPost } from './repos/posts.ts';
import { listEvents, addEvent } from './repos/events.ts';
import { listStyles, createStyle, deleteStyle } from './repos/styles.ts';
import { listTemplates, createTemplate, activateTemplate, deleteTemplate } from './repos/templates.ts';
import {
  SESSION_COOKIE, LoginError, login, createSession, getSessionUser,
  touchSession, destroySession, revokeUserSessions, listUsers, createUser, resetPassword, deleteUser, getUser, type AuthUser,
} from './auth/index.ts';

export const api = new Hono<{ Variables: { user: AuthUser } }>();

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ---------- auth ----------
const LoginBody = z.object({ username: z.string().min(1), password: z.string().min(1) });
const UserInput = z.object({
  username: z.string().regex(/^[a-z0-9_-]{2,32}$/),
  password: z.string().min(8),
  role: z.enum(['admin', 'user']),
});
const PassInput = z.object({ password: z.string().min(8) });
api.post('/auth/login', async (c) => {
  const parsed = LoginBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input' }, 400);
  try {
    const user = await login(c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local', parsed.data.username, parsed.data.password);
    const { token, expiresAt } = await createSession(user.id);
    setCookie(c, SESSION_COOKIE, token, {
      path: '/api', httpOnly: true, sameSite: 'Strict', secure: process.env.NODE_ENV === 'production',
      expires: expiresAt, maxAge: 30 * 24 * 3600,
    });
    return c.json({ ok: true, user: { username: user.username, role: user.role } });
  } catch (e) {
    if (e instanceof LoginError) return c.json({ error: e.message }, e.status === 429 ? 429 : 401);
    return c.json({ error: 'login failed' }, 500);
  }
});

api.post('/auth/logout', async (c) => {
  await destroySession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: '/api' });
  return c.json({ ok: true });
});

// ---------- auth middleware: every /api/* (except login) requires a session ----------
api.use('*', async (c, next) => {
  if (c.req.path === '/auth/login') return next(); // mounted at /api → relative path
  const token = getCookie(c, SESSION_COOKIE);
  const user = await getSessionUser(token);
  if (!user) return c.json({ error: 'not logged in' }, 401);
  c.set('user', user);
  const newExp = await touchSession(token!, user);
  if (newExp) {
    setCookie(c, SESSION_COOKIE, token!, {
      path: '/api', httpOnly: true, sameSite: 'Strict', secure: process.env.NODE_ENV === 'production',
      expires: newExp, maxAge: 30 * 24 * 3600,
    });
  }
  await next();
});

api.get('/auth/me', (c) => {
  const user = c.get('user');
  return c.json({ username: user.username, role: user.role });
});

// ownership: admins see everything, users only their own (user_id null = orphan → admin only).
function canSee(user: AuthUser, groupUserId: string | null): boolean {
  return user.role === 'admin' || groupUserId === user.id;
}

// ---------- users (admin-only) ----------
api.get('/users', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'admin only' }, 403);
  return c.json(await listUsers());
});

api.post('/users', async (c) => {
  const me = c.get('user');
  if (me.role !== 'admin') return c.json({ error: 'admin only' }, 403);
  const body = await c.req.json().catch(() => null);
  const parsed = UserInput.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const { username, password, role } = parsed.data;
  try {
    const u = await createUser(username, password, role);
    return c.json(u, 201);
  } catch (e) {
    return c.json({ error: `failed to create user: ${(e as Error).message}` }, 400);
  }
});

api.post('/users/:id/reset-password', async (c) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'admin only' }, 403);
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const body = await c.req.json().catch(() => null);
  const parsed = PassInput.safeParse(body);
  if (!parsed.success) return c.json({ error: 'password must be at least 8 characters' }, 400);
  const target = await getUser(id);
  if (!target) return c.json({ error: 'user not found' }, 404);
  await resetPassword(target.username, parsed.data.password);
  // revoke all of that user's sessions — new password means logging in again
  await revokeUserSessions(id);
  return c.json({ ok: true });
});

api.delete('/users/:id', async (c) => {
  const me = c.get('user');
  if (me.role !== 'admin') return c.json({ error: 'admin only' }, 403);
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  if (id === me.id) return c.json({ error: 'cannot delete your own account' }, 400);
  const r = await deleteUser(id);
  if (!r.ok) return c.json({ error: r.reason }, 400);
  return c.json({ ok: true });
});

// ---------- groups (multi-account) ----------
api.get('/groups', async (c) => {
  const user = c.get('user');
  const rows = user.role === 'admin' ? await listGroups() : await listGroupsForUser(user.id);
  return c.json(rows.map(groupOut));
});

api.post('/groups', async (c) => {
  const parsed = GroupInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const d = parsed.data;
  try {
    const row = await createGroup({ ...d, user_id: c.get('user').id });
    return c.json(groupOut(row), 201);
  } catch (e) {
    return c.json({ error: `failed to create group: ${(e as Error).message}` }, 400);
  }
});

api.get('/groups/:slug', async (c) => {
  const row = await getGroupRow(c.req.param('slug'));
  if (!row || !canSee(c.get('user'), row.user_id)) return c.json({ error: 'group not found' }, 404);
  return c.json(groupOut(row));
});

api.patch('/groups/:slug', async (c) => {
  const slug = c.req.param('slug');
  const existing = await getGroupRow(slug);
  if (!existing || !canSee(c.get('user'), existing.user_id)) return c.json({ error: 'group not found' }, 404);
  const raw = await c.req.json().catch(() => null);
  const parsed = GroupPatch.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const row = await patchGroup(slug, parsed.data);
  if (!row) return c.json({ error: 'group not found' }, 404);
  await refreshCron(row.id); // cron_expr/enabled may have changed
  return c.json(groupOut(row));
});

api.delete('/groups/:slug', async (c) => {
  const slug = c.req.param('slug');
  const row = await getGroupOwner(slug);
  if (!row || !canSee(c.get('user'), row.user_id)) return c.json({ error: 'group not found' }, 404);
  await deleteGroup(slug);
  await refreshCron(row.id as string); // stop the job
  return c.json({ ok: true });
});

// ---------- group scope: /g/:slug/... ----------
// note: api.route('/g', g) MUST stay at the end of the file — Hono snapshots sub-app routes at mount time.
type GroupRow = Awaited<ReturnType<typeof getGroupRow>>;
const g = new Hono<{ Variables: { user: AuthUser; group: NonNullable<GroupRow> } }>();

g.use('/:slug/*', async (c, next) => {
  const row = await getGroupRow(c.req.param('slug')!);
  if (!row || !canSee(c.get('user'), row.user_id)) return c.json({ error: 'group not found' }, 404);
  c.set('group', row);
  await next();
});

const gr = (c: Context<{ Variables: { user: AuthUser; group: NonNullable<GroupRow> } }>) => c.get('group');

// ---------- dashboard ----------
g.get('/:slug/dashboard', async (c) => c.json(await getDashboard(gr(c).id)));

// ---------- pillars ----------
g.get('/:slug/pillars', async (c) => c.json(await listPillars(gr(c).id)));

g.post('/:slug/pillars', async (c) => {
  const parsed = PillarInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  await createPillar(gr(c).id, parsed.data);
  return c.json({ ok: true }, 201);
});

g.post('/:slug/pillars/:id/toggle', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  await togglePillar(gr(c).id, id);
  return c.json({ ok: true });
});

g.delete('/:slug/pillars/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  await deletePillar(gr(c).id, id);
  return c.json({ ok: true });
});

// ---------- cron (per group) ----------
g.get('/:slug/cron', (c) => c.json(cronStatus(gr(c).id)));

g.post('/:slug/cron', async (c) => {
  const group = gr(c);
  const parsed = CronInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const { expr, enabled } = parsed.data;
  const { validateCronExpression } = await import('cron');
  let valid = false;
  try {
    const res = validateCronExpression(expr);
    valid = typeof res === 'boolean' ? res : res?.valid === true;
  } catch { valid = false; }
  if (!valid) {
    return c.json({ error: 'invalid cron expression (needs 5/6 fields, e.g. "0 7 * * *")' }, 400);
  }
  await saveCron(group.id, expr, enabled);
  await refreshCron(group.id);
  return c.json(cronStatus(group.id));
});

// ---------- posts ----------
g.get('/:slug/posts', async (c) => c.json(await listPosts(gr(c).id)));

g.get('/:slug/posts/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const p = await getPost(gr(c).id, id);
  if (!p) return c.json({ error: 'post not found' }, 404);
  return c.json(p);
});

g.get('/:slug/posts/:id/events', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  return c.json(await listEvents(id, gr(c).id));
});

g.post('/:slug/posts/:id/resend', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  enqueue({ kind: 'resend', slug: gr(c).slug, postId: id });
  return c.json({ ok: true, queued: queueStatus() });
});

// ---------- approval gate ----------
g.post('/:slug/posts/:id/approve', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  enqueue({ kind: 'approve', slug: gr(c).slug, postId: id });
  return c.json({ ok: true, queued: queueStatus() }, 202);
});

g.post('/:slug/posts/:id/reject', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const ok = await rejectPost(gr(c).id, id);
  if (!ok) return c.json({ error: 'post not found or not awaiting approval' }, 400);
  await addEvent(id, gr(c).id, 'rejected');
  return c.json({ ok: true });
});

// ---------- calendar preview ----------
g.get('/:slug/calendar', async (c) => {
  const group = gr(c);
  const n = Math.min(14, Math.max(1, Number(c.req.query('n')) || 7));
  return c.json(await getCalendar(group.id, group.cron_expr, group.cron_enabled, n));
});

// ---------- manual generate ----------
g.post('/:slug/gen', async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = GenerateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid platform/format' }, 400);
  const { platform, format } = parsed.data;
  enqueue({
    kind: 'generate',
    slug: gr(c).slug,
    forced: platform ? { platform, format } : undefined,
    notifyChat: true,
    source: 'web',
  });
  return c.json({ ok: true, queued: queueStatus() }, 202);
});

// ---------- styles ----------
g.get('/:slug/styles', async (c) => c.json(await listStyles(gr(c).id)));

g.post('/:slug/styles', async (c) => {
  const parsed = StyleInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  await createStyle(gr(c).id, parsed.data);
  return c.json({ ok: true }, 201);
});

g.delete('/:slug/styles/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  await deleteStyle(gr(c).id, id);
  return c.json({ ok: true });
});

// ---------- templates ----------
g.get('/:slug/templates', async (c) => c.json(await listTemplates(gr(c).id)));

g.post('/:slug/templates', async (c) => {
  const parsed = TemplateInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  await createTemplate(gr(c).id, parsed.data);
  return c.json({ ok: true }, 201);
});

g.post('/:slug/templates/:id/activate', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  await activateTemplate(gr(c).id, id);
  return c.json({ ok: true });
});

g.delete('/:slug/templates/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  await deleteTemplate(gr(c).id, id);
  return c.json({ ok: true });
});

api.route('/g', g); // mount at the end — see note above

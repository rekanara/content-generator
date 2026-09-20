// JSON API for the SPA frontend — zod-validated via @workspace/shared.
// Two parts: /groups (multi-account CRUD) + /g/:slug/... (all resources scoped to a group).
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { sql } from './db.ts';
import { enqueue, queueStatus } from './queue.ts';
import { refreshCron, cronStatus } from './cron.ts';
import { nextSlot } from './state.ts';
import type { Platform, Format } from './state.ts';
import {
  PillarInput, CronInput, StyleInput, TemplateInput, GenerateInput,
  GroupInput, GroupPatch,
  type Pillar, type PostSummary, type PostDetail, type StyleSample,
  type Template, type Dashboard, type TemplateFormat,
} from '@workspace/shared';
import {
  listGroups, listGroupsForUser, getGroupRow, createGroup, patchGroup, deleteGroup, groupOut,
} from './groups.ts';
import {
  SESSION_COOKIE, LoginError, login, createSession, getSessionUser,
  touchSession, destroySession, listUsers, createUser, resetPassword, deleteUser, getUser, type AuthUser,
} from './auth.ts';

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
  await sql`delete from sessions where user_id = ${id}`;
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
  const [row] = await sql`select id, user_id from groups where slug = ${slug}`;
  if (!row || !canSee(c.get('user'), row.user_id as string | null)) return c.json({ error: 'group not found' }, 404);
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
g.get('/:slug/dashboard', async (c) => {
  const group = gr(c);
  const rows = await sql`select last_platform, last_ig_format, last_li_format,
    last_pillar_id, updated_at from rotation_state where group_id = ${group.id}`;
  const rot = rows[0] ?? {
    last_platform: 'linkedin', last_ig_format: null, last_li_format: null,
    last_pillar_id: null, updated_at: null,
  };
  const pillarRows = await sql`select id, is_news from pillars
    where group_id = ${group.id} and active order by id`;
  const pillars = pillarRows.map((r) => ({ id: r.id as string, is_news: r.is_news as boolean }));
  const next = nextSlot(
    {
      last_platform: rot.last_platform as Platform,
      last_ig_format: rot.last_ig_format,
      last_li_format: rot.last_li_format,
      last_pillar_id: rot.last_pillar_id,
    },
    pillars,
    true,
  );
  const posts = await sql`select id, platform, format, topic, status, source, created_at, pillar_id
    from posts where group_id = ${group.id} order by id desc limit 10`;
  const dash: Dashboard = {
    cron: cronStatus(group.id),
    queue: queueStatus(),
    rotation: {
      last_platform: rot.last_platform ?? '—',
      last_ig_format: rot.last_ig_format,
      last_li_format: rot.last_li_format,
      last_pillar_id: rot.last_pillar_id,
      updated_at: (rot.updated_at as string) ?? null,
    },
    next_slot: next,
    last_posts: posts.map((p) => ({
      id: p.id as string,
      platform: p.platform as string,
      format: p.format as string,
      topic: p.topic as string,
      status: p.status as PostSummary['status'],
      source: p.source as string,
      created_at: (p.created_at as string) ?? new Date().toISOString(),
      pillar_id: (p.pillar_id as string) ?? null,
    })),
  };
  return c.json(dash);
});

// ---------- pillars ----------
g.get('/:slug/pillars', async (c) => {
  const group = gr(c);
  const rows = await sql`select id, name, description, is_news, active, sort_order
    from pillars where group_id = ${group.id} order by sort_order, id`;
  const pillars: Pillar[] = rows.map((r) => ({
    id: r.id as string, name: r.name as string, description: r.description as string,
    is_news: r.is_news as boolean, active: r.active as boolean, sort_order: r.sort_order as number,
  }));
  return c.json(pillars);
});

g.post('/:slug/pillars', async (c) => {
  const group = gr(c);
  const parsed = PillarInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const { name, description, is_news, sort_order } = parsed.data;
  await sql`insert into pillars (group_id, name, description, is_news, sort_order)
    values (${group.id}, ${name}, ${description}, ${is_news}, ${sort_order})`;
  return c.json({ ok: true }, 201);
});

g.post('/:slug/pillars/:id/toggle', async (c) => {
  const group = gr(c);
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  await sql`update pillars set active = not active where id = ${id} and group_id = ${group.id}`;
  return c.json({ ok: true });
});

g.delete('/:slug/pillars/:id', async (c) => {
  const group = gr(c);
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  await sql`delete from pillars where id = ${id} and group_id = ${group.id}`;
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
  await sql`update groups set cron_expr = ${expr}, cron_enabled = ${enabled} where id = ${group.id}`;
  await refreshCron(group.id);
  return c.json(cronStatus(group.id));
});

// ---------- posts ----------
g.get('/:slug/posts', async (c) => {
  const group = gr(c);
  const rows = await sql`select id, platform, format, topic, status, source, created_at, pillar_id
    from posts where group_id = ${group.id} order by id desc limit 100`;
  const posts: PostSummary[] = rows.map((p) => ({
    id: p.id as string, platform: p.platform as string, format: p.format as string,
    topic: p.topic as string, status: p.status as PostSummary['status'],
    source: p.source as string, created_at: (p.created_at as string) ?? new Date().toISOString(),
    pillar_id: (p.pillar_id as string) ?? null,
  }));
  return c.json(posts);
});

g.get('/:slug/posts/:id', async (c) => {
  const group = gr(c);
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const [p] = await sql`select id, platform, format, topic, caption, body, status, error, source, created_at, pillar_id
    from posts where id = ${id} and group_id = ${group.id}`;
  if (!p) return c.json({ error: 'post not found' }, 404);
  const body = JSON.parse(p.body ?? 'null');
  const bodyText = body.body ? body.body
    : body.slides ? body.slides.map((s: { headline: string; body: string }, i: number) => `${i + 1}. ${s.headline}\n${s.body}`).join('\n\n')
    : body.scenes ? body.scenes.map((s: { overlay_text: string; narration: string }, i: number) => `${i + 1}. [${s.overlay_text}] ${s.narration}`).join('\n')
    : JSON.stringify(body);
  const detail: PostDetail = {
    id: p.id as string, platform: p.platform as string, format: p.format as string,
    topic: p.topic as string, status: p.status as PostSummary['status'],
    source: p.source as string, created_at: (p.created_at as string) ?? new Date().toISOString(),
    pillar_id: (p.pillar_id as string) ?? null,
    caption: (p.caption as string) ?? '',
    error: (p.error as string) ?? null,
    body_text: bodyText,
  };
  return c.json(detail);
});

g.post('/:slug/posts/:id/resend', async (c) => {
  const group = gr(c);
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  enqueue({ kind: 'resend', slug: group.slug, postId: id });
  return c.json({ ok: true, queued: queueStatus() });
});

// ---------- manual generate ----------
g.post('/:slug/gen', async (c) => {
  const group = gr(c);
  const raw = await c.req.json().catch(() => ({}));
  const parsed = GenerateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'invalid platform/format' }, 400);
  const { platform, format } = parsed.data;
  enqueue({
    kind: 'generate',
    slug: group.slug,
    forced: platform ? { platform, format } : undefined,
    notifyChat: true,
    source: 'web',
  });
  return c.json({ ok: true, queued: queueStatus() }, 202);
});

// ---------- styles ----------
g.get('/:slug/styles', async (c) => {
  const group = gr(c);
  const rows = await sql`select id, title, body, platform, created_at
    from style_samples where group_id = ${group.id} order by id desc limit 50`;
  const styles: StyleSample[] = rows.map((s) => ({
    id: s.id as string, title: s.title as string, body: s.body as string,
    platform: (s.platform as string) ?? null, created_at: s.created_at as string,
  }));
  return c.json(styles);
});

g.post('/:slug/styles', async (c) => {
  const group = gr(c);
  const parsed = StyleInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const { title, body, platform } = parsed.data;
  await sql`insert into style_samples (group_id, title, body, platform)
    values (${group.id}, ${title}, ${body}, ${platform})`;
  return c.json({ ok: true }, 201);
});

g.delete('/:slug/styles/:id', async (c) => {
  const group = gr(c);
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  await sql`delete from style_samples where id = ${id} and group_id = ${group.id}`;
  return c.json({ ok: true });
});

// ---------- templates ----------
g.get('/:slug/templates', async (c) => {
  const group = gr(c);
  const rows = await sql`select id, name, format, is_active, updated_at
    from templates where group_id = ${group.id} order by id desc limit 50`;
  const templates: Template[] = rows.map((t) => ({
    id: t.id as string, name: t.name as string, format: t.format as TemplateFormat,
    is_active: t.is_active as boolean, updated_at: t.updated_at as string,
  }));
  return c.json(templates);
});

g.post('/:slug/templates', async (c) => {
  const group = gr(c);
  const parsed = TemplateInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const { name, format, html, is_active } = parsed.data;
  if (is_active) {
    await sql`update templates set is_active = false where format = ${format} and group_id = ${group.id}`;
  }
  await sql`insert into templates (group_id, name, format, html, is_active)
    values (${group.id}, ${name}, ${format}, ${html}, ${is_active})`;
  return c.json({ ok: true }, 201);
});

g.post('/:slug/templates/:id/activate', async (c) => {
  const group = gr(c);
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const [t] = await sql`select format from templates where id = ${id} and group_id = ${group.id}`;
  if (t) {
    await sql`update templates set is_active = false where format = ${t.format} and group_id = ${group.id}`;
    await sql`update templates set is_active = true where id = ${id} and group_id = ${group.id}`;
  }
  return c.json({ ok: true });
});

g.delete('/:slug/templates/:id', async (c) => {
  const group = gr(c);
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  await sql`delete from templates where id = ${id} and group_id = ${group.id}`;
  return c.json({ ok: true });
});

api.route('/g', g); // mount at the end — see note above

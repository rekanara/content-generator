// JSON API for the SPA frontend — zod-validated via @workspace/shared.
// Transport layer only: auth/cookies, validation, status codes. Logic lives in repos/usecases.
// Two parts: /groups (multi-account CRUD) + /g/:slug/... (all resources scoped to a group).
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { enqueue, queueStatus } from './queue.ts';
import { refreshCron, cronStatus } from './cron.ts';
import { getDashboard } from './usecases/dashboard.ts';
import { getCalendar } from './usecases/calendar.ts';
import { getGroupUsage, getAllGroupsUsage } from './usecases/usage.ts';
import { getPostArtifact } from './usecases/artifacts.ts';
import { getArtifactStream, statArtifact } from './storage.ts';
import {
  PillarInput, CronInput, StyleInput, TemplateInput, GenerateInput,
  GroupInput, GroupPatch, PillarEdit, StyleEdit, TemplateEdit, OverrideInput, PlanInput, PromotionInput,
} from '@workspace/shared';
import {
  listGroups, listGroupsForUser, getGroupRow, getGroupCfg, createGroup, patchGroup, deleteGroup, groupOut,
  getGroupOwner, saveCron,
} from './groups.ts';
import { listPillars, createPillar, togglePillar, deletePillar, updatePillar } from './repos/pillars.ts';
import { listPosts, getPost, rejectPost } from './repos/posts.ts';
import { listEvents, addEvent } from './repos/events.ts';
import { listStyles, createStyle, deleteStyle, updateStyle } from './repos/styles.ts';
import { listTemplates, createTemplate, activateTemplate, deleteTemplate, getTemplate, updateTemplate } from './repos/templates.ts';
import { listOverrides, getOverride, createOverrideWithPlan, cancelOverride, deleteOverride, updateOverrideImages } from './repos/overrides.ts';
import { listPlans, getPlan, createPlan, cancelPlan, deletePlan } from './repos/plans.ts';
import { listPromotions, getPromotion, createPromotion, updatePromotion, deletePromotion } from './repos/promotions.ts';
import { generatePromotionContent, draftPromotionFromBrief, notifyImageSlots, deliverPromotion, storePromoImage, allImagesPresent, imageSlotStatus } from './usecases/promotions.ts';
import { uploadOverrideBuffer } from './storage.ts';
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
  try {
    await createPillar(gr(c).id, parsed.data);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return c.json({ error: 'pillar name already exists in this group' }, 400);
    throw e; // infra errors stay 500s
  }
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

g.patch('/:slug/pillars/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = PillarEdit.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  let ok: boolean;
  try {
    ok = await updatePillar(gr(c).id, id, parsed.data);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return c.json({ error: 'pillar name already exists in this group' }, 400);
    throw e; // infra errors stay 500s
  }
  if (!ok) return c.json({ error: 'pillar not found' }, 404);
  return c.json(await listPillars(gr(c).id));
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

// artifact streaming (slides PNG / carousel PDF / reel MP4) — session-authed, group-scoped.
// no-store: rerender overwrites the same keys — a cached image would show a stale template.
// ponytail: HTTP range requests if video seeking ever matters (progressive playback works).
g.get('/:slug/posts/:id/artifacts/:file', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const file = c.req.param('file');
  const a = await getPostArtifact(gr(c).id, gr(c).slug, id, file).catch(() => null);
  if (!a) return c.json({ error: 'artifact not found' }, 404);
  return new Response(Readable.toWeb(a.stream) as unknown as ReadableStream, {    headers: {
      'content-type': a.contentType,
      'content-length': String(a.size),
      'cache-control': 'private, no-store',
    },
  });
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

// skip the manual cover ask — render without a cover page (FE parity with the Telegram button)
g.post('/:slug/posts/:id/skip-cover', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const post = await getPost(gr(c).id, id);
  if (!post) return c.json({ error: 'post not found' }, 404);
  if (post.status !== 'awaiting_cover') {
    return c.json({ error: `post status ${post.status} — nothing to skip` }, 400);
  }
  enqueue({ kind: 'coverContinue', slug: gr(c).slug, postId: id, skipCover: true });
  return c.json({ ok: true, queued: queueStatus() }, 202);
});

// re-render with the current template (same content) — Telegram /rerender parity
g.post('/:slug/posts/:id/rerender', async (c) => {  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const post = await getPost(gr(c).id, id);
  if (!post) return c.json({ error: 'post not found' }, 404);
  if (post.format === 'text') return c.json({ error: 'text format has no visual template' }, 400);
  if (!['sent', 'awaiting_approval', 'rendered'].includes(post.status)) {
    return c.json({ error: `post status ${post.status} — rerender works on sent/awaiting/rendered` }, 400);
  }
  enqueue({ kind: 'rerender', slug: gr(c).slug, postId: id });
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

g.patch('/:slug/styles/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = StyleEdit.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const ok = await updateStyle(gr(c).id, id, parsed.data);
  if (!ok) return c.json({ error: 'style not found' }, 404);
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

g.get('/:slug/templates/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const t = await getTemplate(gr(c).id, id);
  if (!t) return c.json({ error: 'template not found' }, 404);
  return c.json(t);
});

g.patch('/:slug/templates/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = TemplateEdit.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const ok = await updateTemplate(gr(c).id, id, parsed.data);
  if (!ok) return c.json({ error: 'template not found' }, 404);
  return c.json({ ok: true });
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

// ---------- override content ----------
// GET list / POST create (multipart: name,type,template_id,description,for_date + images[] files)
g.get('/:slug/overrides', async (c) => c.json(await listOverrides(gr(c).id)));

g.post('/:slug/overrides', async (c) => {
  const group = gr(c);
  let body: Record<string, string | File | (string | File)[]>;
  try {
    body = await c.req.parseBody({ all: true }) as Record<string, string | File | (string | File)[]>;
  } catch {
    return c.json({ error: 'invalid form body (use multipart/form-data)' }, 400);
  }
  const field = (k: string): string => {
    const v = body[k];
    return typeof v === 'string' ? v : '';
  };
  const rawFiles = body['images'];
  const files = (Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : []).filter((f): f is File => f instanceof File);

  const templateIdRaw = field('template_id');
  const parsed = OverrideInput.safeParse({
    name: field('name'),
    type: field('type'),
    template_id: templateIdRaw === '' ? null : templateIdRaw,
    description: field('description'),
    for_date: field('for_date'),
  });
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const { name, type, description, for_date } = parsed.data;
  const template_id = parsed.data.template_id;

  // image count rules per type — enforced here so both FE and API callers get the same guard
  if (type === 'text_only' && files.length > 0) return c.json({ error: 'text_only must not have images' }, 400);
  if (type === 'mix' && files.length !== 1) return c.json({ error: 'mix needs exactly 1 image' }, 400);
  if (type === 'image_only' && (files.length < 1 || files.length > 10)) return c.json({ error: 'image_only needs 1-10 images' }, 400);
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  for (const f of files) {
    if (!ALLOWED.includes(f.type)) return c.json({ error: `unsupported image type: ${f.type}` }, 400);
    if (f.size > 10 * 1024 * 1024) return c.json({ error: 'image exceeds 10MB' }, 400);
  }

  try {
    // upload images BEFORE creating the row — a failed upload must not leave an
    // orphan scheduled override owning the date. Buffer the files, insert last.
    const staged: { fname: string; buf: Buffer }[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const ext = f.type === 'image/jpeg' ? 'jpg' : f.type === 'image/webp' ? 'webp' : 'png';
      staged.push({ fname: `img-${String(i + 1).padStart(2, '0')}.${ext}`, buf: Buffer.from(await f.arrayBuffer()) });
    }
    const ov = await createOverrideWithPlan(group.id, { name, type, template_id, description, for_date, images: [] });
    const names: string[] = [];
    for (const { fname, buf } of staged) {
      await uploadOverrideBuffer(ov.id, buf, fname);
      names.push(fname);
    }
    if (names.length > 0) await updateOverrideImages(ov.id, names);
    return c.json({ ...ov, images: names }, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('overrides_group_date')) return c.json({ error: 'an override already exists for that date (cancel it first)' }, 400);
    if (msg.includes('plans_group_date')) return c.json({ error: 'that date already has a plan (cancel the plan first)' }, 400);
    throw e;
  }
});

// ---------- plans (date-scoped source of truth) ----------
g.get('/:slug/plans', async (c) => c.json(await listPlans(gr(c).id)));

// create slot_override — pin platform/format/pillar/template for a date's pipeline run
g.post('/:slug/plans', async (c) => {
  const parsed = PlanInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const d = parsed.data;
  if (d.template_id) {
    const t = await getTemplate(gr(c).id, d.template_id);
    if (!t) return c.json({ error: 'template not found' }, 404);
  }
  if (d.pillar_id) {
    const exists = await listPillars(gr(c).id).then((ps) => ps.some((p) => p.id === d.pillar_id));
    if (!exists) return c.json({ error: 'pillar not found' }, 404);
  }
  try {
    const plan = await createPlan(gr(c).id, {
      for_date: d.for_date, type: 'slot_override',
      platform: d.platform ?? null, format: d.format ?? null,
      pillar_id: d.pillar_id ?? null, template_id: d.template_id ?? null,
      note: d.note,
    });
    return c.json(plan, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('plans_group_date')) return c.json({ error: 'that date already has an active plan or override (cancel it first)' }, 400);
    throw e;
  }
});

g.post('/:slug/plans/:id/cancel', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const ok = await cancelPlan(gr(c).id, id);
  if (!ok) return c.json({ error: 'plan not found or not active' }, 400);
  return c.json({ ok: true });
});

g.delete('/:slug/plans/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const ok = await deletePlan(gr(c).id, id);
  if (!ok) return c.json({ error: 'plan not found' }, 404);
  return c.json({ ok: true });
});

// stream an override image (list view thumbnails) — same shape guard + whitelist as posts
g.get('/:slug/overrides/:id/images/:file', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const file = c.req.param('file');
  if (!/^img-\d{2,3}\.(png|jpg|webp)$/.test(file)) return c.json({ error: 'invalid file' }, 400);
  const ov = await getOverride(gr(c).id, id);
  if (!ov || !ov.images.includes(file)) return c.json({ error: 'image not found' }, 404);
  const key = `overrides/${id}/${file}`;
  const size = await statArtifact(key).catch(() => null);
  if (size === null) return c.json({ error: 'image not found' }, 404);
  const ext = file.split('.').pop()!;
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  const stream = Readable.from(await getArtifactStream(key));
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: { 'content-type': mime, 'content-length': String(size), 'cache-control': 'private, no-store' },
  });
});

g.post('/:slug/overrides/:id/cancel', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const ok = await cancelOverride(gr(c).id, id);
  if (!ok) return c.json({ error: 'override not found or not scheduled' }, 400);
  return c.json({ ok: true });
});

g.delete('/:slug/overrides/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const ok = await deleteOverride(gr(c).id, id);
  if (!ok) return c.json({ error: 'override not found' }, 404);
  return c.json({ ok: true });
});

// ---------- usage (token/cost reporting) ----------
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
// global rollup — all visible groups (admin: everything; user: own groups)
api.get('/usage', async (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 30));
  const user = c.get('user');
  const rows = user.role === 'admin'
    ? await listGroups()
    : await listGroupsForUser(user.id);
  const all = await getAllGroupsUsage(days);
  const visible = new Set(rows.map((g) => g.id));
  const groups = all.filter((g) => visible.has(g.group.id));
  return c.json({
    sinceDays: days,
    groups,
    total: {
      cost: round4(groups.reduce((a, g) => a + g.cost, 0)),
      promptTokens: groups.reduce((a, g) => a + g.promptTokens, 0),
      completionTokens: groups.reduce((a, g) => a + g.completionTokens, 0),
    },
  });
});

// per-group usage
g.get('/:slug/usage', async (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 30));
  return c.json(await getGroupUsage(gr(c).id, days));
});

// ---------- promotions ----------
g.get('/:slug/promotions', async (c) => c.json(await listPromotions(gr(c).id)));

g.get('/:slug/promotions/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const p = await getPromotion(gr(c).id, id);
  if (!p) return c.json({ error: 'promotion not found' }, 404);
  return c.json(p);
});

// create — manual data, or AI-drafted from a brief (brief field present)
g.post('/:slug/promotions', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const brief = typeof (raw as Record<string, unknown>)?.brief === 'string' ? (raw as { brief: string }).brief.trim() : '';
  let data: unknown;
  if (brief) {
    try { data = await draftPromotionFromBrief(await getGroupCfg(gr(c).slug), brief); }
    catch (e) { return c.json({ error: `AI brief failed: ${(e as Error).message}` }, 502); }
  } else {
    const parsed = PromotionInput.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
    data = parsed.data;
  }
  // normalize through the same zod — but preserve the caller's template choice:
  // the AI draft carries no template_id, and the FE dropdown is the source of truth
  const templateIdRaw = (raw as Record<string, unknown>)?.template_id;
  const input = PromotionInput.parse(data);
  if (brief && typeof templateIdRaw === 'string' && templateIdRaw !== '') {
    input.template_id = templateIdRaw;
  }
  try {
    const p = await createPromotion(gr(c).id, input);
    return c.json(p, 201);
  } catch (e) {
    return c.json({ error: `failed to create promotion: ${(e as Error).message}` }, 400);
  }
});

g.patch('/:slug/promotions/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = PromotionInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const ok = await updatePromotion(gr(c).id, id, parsed.data);
  if (!ok) return c.json({ error: 'promotion not found' }, 404);
  return c.json({ ok: true });
});

g.delete('/:slug/promotions/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const ok = await deletePromotion(gr(c).id, id);
  if (!ok) return c.json({ error: 'promotion not found' }, 404);
  return c.json({ ok: true });
});

// AI writes the slides + reports image slots
g.post('/:slug/promotions/:id/generate-content', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  try {
    const r = await generatePromotionContent(await getGroupCfg(gr(c).slug), id);
    await notifyImageSlots(await getGroupCfg(gr(c).slug), id);
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ error: `content generation failed: ${(e as Error).message}` }, 502);
  }
});

// upload image for a slide slot (multipart: slide + file)
g.post('/:slug/promotions/:id/images', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  let body: Record<string, string | File>;
  try { body = await c.req.parseBody() as Record<string, string | File>; } catch { return c.json({ error: 'invalid form body' }, 400); }
  const slide = Number(body['slide']);
  const file = body['file'];
  if (!Number.isInteger(slide) || slide < 1 || slide > 10 || !(file instanceof File)) {
    return c.json({ error: 'need slide (number) + file' }, 400);
  }
  await storePromoImage(await getGroupCfg(gr(c).slug), id, slide, Buffer.from(await file.arrayBuffer()));
  const ready = await allImagesPresent(await getGroupCfg(gr(c).slug), id);
  return c.json({ ok: true, allImagesPresent: ready });
});

// per-slot image status (drives the FE upload UI)
g.get('/:slug/promotions/:id/image-slots', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  return c.json(await imageSlotStatus(await getGroupCfg(gr(c).slug), id));
});

// send now (rotation untouched)
g.post('/:slug/promotions/:id/send', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const p = await getPromotion(gr(c).id, id);
  if (!p) return c.json({ error: 'promotion not found' }, 404);
  if (!p.content) return c.json({ error: 'no content — generate content first' }, 400);
  const tpl = p.template_id ? await getTemplate(gr(c).id, p.template_id) : null; // null template_id → default (ig)
  const platform = tpl?.format?.endsWith('li-carousel-promo') ? 'linkedin' : 'instagram';
  enqueue({ kind: 'promoSend', slug: gr(c).slug, promoId: id, platform });
  return c.json({ ok: true, queued: queueStatus() }, 202);
});

// schedule via plans (type promotion — the date's run delivers this promo)
g.post('/:slug/promotions/:id/schedule', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const body = await c.req.json().catch(() => null);
  const forDate = (body as { for_date?: string })?.for_date;
  if (!forDate || !/^\d{4}-\d{2}-\d{2}$/.test(forDate)) return c.json({ error: 'for_date required (YYYY-MM-DD)' }, 400);
  try {
    const plan = await createPlan(gr(c).id, { for_date: forDate, type: 'promotion', promotion_id: id, note: `promo ${id.slice(0, 8)}` } as never);
    return c.json(plan, 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('plans_group_date')) return c.json({ error: 'that date already has a plan' }, 400);
    throw e;
  }
});

api.route('/g', g); // mount at the end — see note above

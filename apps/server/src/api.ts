// JSON API for the SPA frontend — zod-validated via @workspace/shared.
// Transport layer only: auth/cookies, validation, status codes. Logic lives in repos/usecases.
// Two parts: /groups (multi-account CRUD) + /g/:slug/... (all resources scoped to a group).
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { sql } from './db/pool.ts';
import { enqueue, queueStatus } from './queue.ts';
import { readRun } from './progress.ts';
import { chatJson, writerModel } from './llm.ts';
import { overridePolishPrompt, pillarSuggestPrompt, styleSuggestPrompt } from './prompts.ts';
import { isPolishOut, isPillarsOut, cleanPillarSuggestions, isStylesOut, cleanStyleSuggestions } from './schema.ts';
import { refreshCron, cronStatus } from './cron.ts';
import { getDashboard } from './usecases/dashboard.ts';
import { getCalendar } from './usecases/calendar.ts';
import { getGroupUsage, getAllGroupsUsage } from './usecases/usage.ts';
import { getPostArtifact } from './usecases/artifacts.ts';
import { getArtifactStream, statArtifact } from './storage.ts';
import {
  PillarInput, PillarSuggestInput, CronInput, StyleInput, TemplateInput, GenerateInput,
  GroupInput, GroupPatch, PillarEdit, StyleEdit, TemplateEdit, OverrideInput, PlanInput, PromotionInput, IdeaInput, NewsTopicInput, NewsSourceInput, NewsRuleInput, NewsTemplateInput, NewsGenerateInput, NewsCaptionInput,
} from '@workspace/shared';
import {
  listGroups, listGroupsForUser, getGroupRow, getGroupCfg, createGroup, patchGroup, deleteGroup, groupOut,
  getGroupOwner, saveCron, saveBrief,
} from './groups.ts';
import { listPillars, createPillar, togglePillar, deletePillar, updatePillar } from './repos/pillars.ts';
import { listPosts, getPost, rejectPost, toggleStar } from './repos/posts.ts';
import { listEvents, addEvent } from './repos/events.ts';
import { listStyles, createStyle, deleteStyle, updateStyle } from './repos/styles.ts';
import { listIdeas, addIdea, deleteIdea } from './repos/ideas.ts';
import { listNewsTopics, createNewsTopic, getNewsTopic, addNewsSource, deleteNewsSource, upsertNewsRules, deleteNewsItems, setNewsTopicTemplate, setNewsTopicCaption, getNewsTopicTemplate, claimValidNewsItem } from './repos/news.ts';
import { listTemplates, createTemplate, activateTemplate, deleteTemplate, getTemplate, updateTemplate } from './repos/templates.ts';
import { listOverrides, getOverride, createOverrideWithPlan, cancelOverride, deleteOverride, updateOverrideImages, updateOverrideDescription, updateOverrideCaptionParts } from './repos/overrides.ts';
import { listPlans, getPlan, createPlan, cancelPlan, deletePlan } from './repos/plans.ts';
import { listPromotions, getPromotion, createPromotion, updatePromotion, deletePromotion, setPromotionTemplate, setPromotionCaption } from './repos/promotions.ts';
import { generatePromotionContent, draftPromotionFromBrief, notifyImageSlots, deliverPromotion, storePromoImage, allImagesPresent, imageSlotStatus, regeneratePromotionContent } from './usecases/promotions.ts';
import { autofillNewsTopic, startIngest, getIngestProgress } from './usecases/news.ts';
import { uploadOverrideBuffer } from './storage.ts';
import { recordLlmRun } from './repos/llm-runs.ts';
import {
  SESSION_COOKIE, LoginError, login, createSession, getSessionUser,
  touchSession, destroySession, revokeUserSessions, listUsers, createUser, resetPassword, deleteUser, getUser, type AuthUser,
} from './auth/index.ts';

export const api = new Hono<{ Variables: { user: AuthUser } }>();

function publicError(e: unknown): { message: string; status: 500 | 502 } {
  const raw = e instanceof Error ? e.message : String(e);
  if (/\b(LLM|image|AI suggestion)\b/i.test(raw)) {
    const msg = raw
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/api[_-]?key[^,"'}]*/gi, 'api_key [redacted]')
      .slice(0, 300);
    return { status: 502, message: msg };
  }
  return { status: 500, message: 'internal server error' };
}

api.onError((err, c) => {
  const e = publicError(err);
  console.error(`[api] ${err.message}`);
  return c.json({ error: e.message }, e.status);
});

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
// live pipeline telemetry for the single active queue run (dashboard progress)
api.get('/queue/live', async (c) => c.json({ run: readRun(), queue: queueStatus() }));

api.get('/groups', async (c) => {  const user = c.get('user');
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

// AI pillar suggestions — saves the brief (reusable context), returns proposals only.
// The human picks/edits in the FE and inserts via POST /pillars (no DB write of pillars here).
g.post('/:slug/pillars/suggest', async (c) => {
  const parsed = PillarSuggestInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'brief must be 20-8000 characters', issues: parsed.error.issues }, 400);
  const group = gr(c);
  await saveBrief(group.id, parsed.data.brief);
  const cfg = await getGroupCfg(group.slug);
  const existing = await listPillars(group.id);
  let out;
  try {
    out = await chatJson(cfg, writerModel(cfg), pillarSuggestPrompt(parsed.data.brief, existing), isPillarsOut, 3000, 120_000);
  } catch (e) {
    return c.json({ error: `AI suggestion failed: ${(e as Error).message}` }, 502); // brief is saved — retry is one click
  }
  await recordLlmRun(group.id, 'pillars', writerModel(cfg), out.usage.prompt, out.usage.completion).catch(() => {});
  return c.json({ pillars: cleanPillarSuggestions(out.data, existing) });
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

// toggle the quality star (planner signal + style-sample candidate marker)
g.post('/:slug/posts/:id/star', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const starred = await toggleStar(gr(c).id, id);
  if (starred === null) return c.json({ error: 'post not found' }, 404);
  return c.json({ ok: true, starred });
});

// regenerate — same contract as the Telegram Regenerate button: awaiting posts
// are rejected first (instant, rotation-safe), then a fresh generate run starts
// (plan-aware: a plan owning today overrides the natural slot as usual).
g.post('/:slug/posts/:id/regenerate', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const post = await getPost(gr(c).id, id);
  if (!post) return c.json({ error: 'post not found' }, 404);
  if (!['awaiting_approval', 'rejected', 'failed'].includes(post.status)) {
    return c.json({ error: `post status ${post.status} — regenerate works on awaiting/rejected/failed` }, 400);
  }
  if (post.status === 'awaiting_approval') {
    const ok = await rejectPost(gr(c).id, id);
    if (!ok) return c.json({ error: 'post left awaiting concurrently' }, 409);
    await addEvent(id, gr(c).id, 'rejected', 'regenerate via FE').catch(() => {});
  }
  enqueue({ kind: 'generate', slug: gr(c).slug, notifyChat: true, source: 'regen' });
  return c.json({ ok: true, queued: queueStatus() }, 202);
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

// AI style samples from the ACTIVE pillars (+ group brief) — proposals only;
// the human edits/picks in the FE and inserts via POST /styles.
g.post('/:slug/styles/suggest', async (c) => {
  const group = gr(c);
  const pillars = (await listPillars(group.id)).filter((p) => p.active);
  if (pillars.length === 0) return c.json({ error: 'add at least one active pillar first' }, 400);
  const cfg = await getGroupCfg(group.slug);
  const existing = await listStyles(group.id, 20);
  let out;
  try {
    out = await chatJson(cfg, writerModel(cfg), styleSuggestPrompt(pillars, group.brief, existing), isStylesOut, 4000, 120_000);
  } catch (e) {
    return c.json({ error: `AI suggestion failed: ${(e as Error).message}` }, 502);
  }
  await recordLlmRun(group.id, 'styles', writerModel(cfg), out.usage.prompt, out.usage.completion).catch(() => {});
  return c.json({ samples: cleanStyleSuggestions(out.data, existing) });
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

// ---------- ideas ----------
g.get('/:slug/ideas', async (c) => c.json(await listIdeas(gr(c).id)));

g.post('/:slug/ideas', async (c) => {
  const parsed = IdeaInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const idea = await addIdea(gr(c).id, parsed.data.text, 'fe');
  return c.json(idea, 201);
});

g.delete('/:slug/ideas/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  await deleteIdea(gr(c).id, id);
  return c.json({ ok: true });
});

// ---------- news ----------
g.get('/:slug/news/topics', async (c) => c.json(await listNewsTopics(gr(c).id)));

g.post('/:slug/news/topics', async (c) => {
  const parsed = NewsTopicInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  try {
    return c.json(await createNewsTopic(gr(c).id, parsed.data), 201);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return c.json({ error: 'news topic already exists in this group' }, 400);
    throw e;
  }
});

g.get('/:slug/news/topics/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const topic = await getNewsTopic(gr(c).id, id);
  if (!topic) return c.json({ error: 'news topic not found' }, 404);
  return c.json(topic);
});

g.post('/:slug/news/topics/:id/autofill', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const topic = await getNewsTopic(gr(c).id, id);
  if (!topic) return c.json({ error: 'news topic not found' }, 404);
  const fill = await autofillNewsTopic(await getGroupCfg(gr(c).slug), topic);
  await upsertNewsRules(gr(c).id, id, {
    freshness_hours: topic.rules.freshness_hours,
    min_sources: topic.rules.min_sources,
    allowed_domains: fill.allowed_domains,
    blocked_domains: topic.rules.blocked_domains,
    keywords: fill.keywords,
  });
  for (const source of fill.sources) {
    await addNewsSource(gr(c).id, id, source).catch((e) => {
      if ((e as { code?: string }).code !== '23505') throw e;
    });
  }
  return c.json(await getNewsTopic(gr(c).id, id));
});

g.post('/:slug/news/topics/:id/sources', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = NewsSourceInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  try {
    const source = await addNewsSource(gr(c).id, id, parsed.data);
    if (!source) return c.json({ error: 'news topic not found' }, 404);
    return c.json(source, 201);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return c.json({ error: 'source URL already exists in this topic' }, 400);
    throw e;
  }
});

g.delete('/:slug/news/topics/:id/sources/:sourceId', async (c) => {
  const id = c.req.param('id');
  const sourceId = c.req.param('sourceId');
  if (!isUuid(id) || !isUuid(sourceId)) return c.json({ error: 'invalid id' }, 400);
  await deleteNewsSource(gr(c).id, id, sourceId);
  return c.json({ ok: true });
});

g.put('/:slug/news/topics/:id/rules', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = NewsRuleInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const rules = await upsertNewsRules(gr(c).id, id, parsed.data);
  if (!rules) return c.json({ error: 'news topic not found' }, 404);
  return c.json(rules);
});

g.put('/:slug/news/topics/:id/template', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = NewsTemplateInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  if (parsed.data.template_id) {
    const t = await getTemplate(gr(c).id, parsed.data.template_id);
    if (!t) return c.json({ error: 'template not found' }, 404);
    if (t.type !== 'regular' || !['ig-news-card', 'ig-carousel'].includes(t.format)) return c.json({ error: 'template must be regular ig-news-card or ig-carousel' }, 400);
  }
  const ok = await setNewsTopicTemplate(gr(c).id, id, parsed.data.template_id);
  if (!ok) return c.json({ error: 'news topic not found' }, 404);
  return c.json({ ok: true });
});

g.put('/:slug/news/topics/:id/caption', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = NewsCaptionInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const ok = await setNewsTopicCaption(gr(c).id, id, parsed.data);
  if (!ok) return c.json({ error: 'news topic not found' }, 404);
  return c.json({ ok: true });
});

g.post('/:slug/news/topics/:id/generate', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = NewsGenerateInput.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const templateId = await getNewsTopicTemplate(gr(c).id, id);
  if (templateId === undefined) return c.json({ error: 'news topic not found' }, 404);
  const item = await claimValidNewsItem(gr(c).id, { topicId: id, itemId: parsed.data.item_id });
  if (!item) return c.json({ error: 'valid news item not found' }, 404);
  enqueue({
    kind: 'generate',
    slug: gr(c).slug,
    forced: { platform: 'instagram', format: 'carousel' },
    notifyChat: true,
    source: 'web',
    newsTopicId: id,
    newsItemId: item.id,
    newsLanguage: parsed.data.language,
    templateId: templateId ?? undefined,
  });
  return c.json({ ok: true, queued: queueStatus() }, 202);
});

// async: starts the fetch and returns 202 — the FE polls /ingest/status (a fetch with
// AI scoring takes minutes; a blocking request looked frozen and forced a page refresh)
g.post('/:slug/news/topics/:id/ingest', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  if ((await getNewsTopicTemplate(gr(c).id, id)) === undefined) return c.json({ error: 'news topic not found' }, 404);
  const started = startIngest(gr(c).id, id, await getGroupCfg(gr(c).slug));
  return c.json({ ok: true, started, progress: getIngestProgress(id) }, 202);
});

g.get('/:slug/news/topics/:id/ingest/status', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  if ((await getNewsTopicTemplate(gr(c).id, id)) === undefined) return c.json({ error: 'news topic not found' }, 404);
  return c.json({ progress: getIngestProgress(id) });
});

g.post('/:slug/news/topics/:id/items/delete', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = z.object({
    ids: z.array(z.string().uuid()).optional(),
    status: z.enum(['pending', 'valid', 'rejected', 'used']).optional(),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const n = await deleteNewsItems(gr(c).id, id, parsed.data.ids, parsed.data.status ?? 'rejected');
  return c.json({ ok: true, deleted: n });
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

// AI-polish the manual description BEFORE creating — the human stays in the loop:
// FE shows the polished preview, the user picks (accept → replaces the textarea,
// keep → original stays). No DB write here.
g.post('/:slug/overrides/polish', async (c) => {
  const PolishBody = z.object({ name: z.string().min(1), type: z.enum(['mix', 'image_only', 'text_only']), description: z.string().min(5) });
  const parsed = PolishBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const group = gr(c);
  const cfg = await getGroupCfg(group.slug);
  const samples = (await sql`select title, body, platform from style_samples
    where group_id = ${group.id} order by created_at desc limit 4`) as unknown as { title: string; body: string; platform: string | null }[];
  const out = await chatJson(
    cfg, writerModel(cfg),
    overridePolishPrompt(parsed.data, samples as { title: string; body: string; platform: string | null }[]),
    isPolishOut, 4000,
  );
  await recordLlmRun(group.id, 'polish', writerModel(cfg), out.usage.prompt, out.usage.completion).catch(() => {});
  return c.json({ polished: out.data.polished.trim() });
});

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
    caption_cta: field('caption_cta'),
    caption_footer: field('caption_footer'),
  });
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const { name, type, description, for_date, caption_cta, caption_footer } = parsed.data;
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
    const ov = await createOverrideWithPlan(group.id, { name, type, template_id, description, for_date, images: [], caption_cta, caption_footer });
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

// re-deliver a SENT override — same content, same images. Rotation was never
// consumed by overrides, so this is a pure resend (status stays 'sent').
g.post('/:slug/overrides/:id/resend', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const ov = await getOverride(gr(c).id, id);
  if (!ov) return c.json({ error: 'override not found' }, 404);
  if (ov.status !== 'sent') return c.json({ error: `status ${ov.status} — resend re-delivers a SENT override` }, 400);
  enqueue({ kind: 'overrideSend', slug: gr(c).slug, overrideId: id });
  return c.json({ ok: true, queued: queueStatus() }, 202);
});

// description edit (polish-accept flow) — scheduled only: a sent override's
// text must keep matching what actually shipped.
g.patch('/:slug/overrides/:id', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = z.object({ description: z.string().min(1).optional() })
    .and(NewsCaptionInput.partial())
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  const ov = await getOverride(gr(c).id, id);
  if (!ov) return c.json({ error: 'override not found' }, 404);
  const { description } = parsed.data;
  // description is what shipped — frozen after send; CTA/footer still editable (affects Resend)
  if (description !== undefined) {
    if (ov.status !== 'scheduled') return c.json({ error: `status ${ov.status} — only scheduled overrides can be edited` }, 400);
    if (!(await updateOverrideDescription(gr(c).id, id, description))) return c.json({ error: 'override not found' }, 404);
  }
  if (parsed.data.caption_cta !== undefined || parsed.data.caption_footer !== undefined) {
    await updateOverrideCaptionParts(gr(c).id, id, { caption_cta: parsed.data.caption_cta, caption_footer: parsed.data.caption_footer });
  }
  return c.json({ ok: true });
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
  if (brief) {
    const cap = NewsCaptionInput.safeParse(raw);
    if (cap.success) Object.assign(input, cap.data);
  }
  try {
    const p = await createPromotion(gr(c).id, input);
    return c.json(p, 201);
  } catch (e) {
    return c.json({ error: `failed to create promotion: ${(e as Error).message}` }, 400);
  }
});

g.put('/:slug/promotions/:id/caption', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const parsed = NewsCaptionInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
  if (!(await setPromotionCaption(gr(c).id, id, parsed.data))) return c.json({ error: 'promotion not found' }, 404);
  return c.json({ ok: true });
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

// re-generate slides — same data, fresh AI content. Optional template switch:
// body { template_id?: string | null } — null/absent keeps the current template.
g.post('/:slug/promotions/:id/regenerate', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const templateId = (body as { template_id?: string | null }).template_id ?? undefined;
  if (templateId !== undefined && templateId !== null && !isUuid(templateId)) {
    return c.json({ error: 'invalid template_id' }, 400);
  }
  try {
    const r = await regeneratePromotionContent(await getGroupCfg(gr(c).slug), id, templateId);
    await notifyImageSlots(await getGroupCfg(gr(c).slug), id);
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// re-render + resend a SENT promo with the current template row (template edits
// come through — same content). Optional body { template_id?: string | null }:
// switch the promo to a different promo template first (or null = built-in
// default). Non-sent promos render at send time already.
g.post('/:slug/promotions/:id/rerender', async (c) => {
  const id = c.req.param('id');
  if (!isUuid(id)) return c.json({ error: 'invalid id' }, 400);
  const p = await getPromotion(gr(c).id, id);
  if (!p) return c.json({ error: 'promotion not found' }, 404);
  if (p.status !== 'sent') return c.json({ error: `status ${p.status} — rerender resends a SENT promo (template edits apply)` }, 400);
  if (!p.content) return c.json({ error: 'no content' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const templateId = (body as { template_id?: string | null }).template_id;
  if (templateId !== undefined && templateId !== null && !isUuid(templateId)) {
    return c.json({ error: 'invalid template_id' }, 400);
  }
  let platform: 'instagram' | 'linkedin';
  if (templateId === undefined) {
    // keep the pinned template as-is — plain re-render
    const tpl = p.template_id ? await getTemplate(gr(c).id, p.template_id) : null;
    platform = tpl?.format?.endsWith('li-carousel-promo') ? 'linkedin' : 'instagram';
  } else {
    // switch (or clear to default) — must be a promo template: a regular
    // ig-carousel row has {{headline}} tokens, not the {{content}} hole
    const tpl = templateId ? await getTemplate(gr(c).id, templateId) : null;
    if (templateId && !tpl) return c.json({ error: 'template not found' }, 404);
    if (tpl && !tpl.format.endsWith('-promo')) {
      return c.json({ error: `template "${tpl.name}" is ${tpl.format} — re-render needs a promo template` }, 400);
    }
    await setPromotionTemplate(id, templateId);
    platform = tpl?.format?.endsWith('li-carousel-promo') ? 'linkedin' : 'instagram';
  }
  enqueue({ kind: 'promoSend', slug: gr(c).slug, promoId: id, platform });
  return c.json({ ok: true, queued: queueStatus() }, 202);
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

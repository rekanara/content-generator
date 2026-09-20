// JSON API untuk FE SPA — zod-validated via @workspace/shared.
// Menggantikan admin.ts SSR (HTMX) — kontrak = schema di packages/shared.
import { Hono } from 'hono';
import { sql, getActivePillars } from './db.ts';
import { enqueue, queueStatus } from './queue.ts';
import { refreshCron, cronStatus } from './cron.ts';
import { nextSlot } from './state.ts';
import type { Platform, Format } from './state.ts';
import {
  PillarInput, CronInput, StyleInput, TemplateInput, GenerateInput,
  type Pillar, type PostSummary, type PostDetail, type StyleSample,
  type Template, type Dashboard, type TemplateFormat,
} from '@workspace/shared';

export const api = new Hono();

// ---------- dashboard ----------
api.get('/dashboard', async (c) => {
  const rows = await sql`select last_platform, last_ig_format, last_li_format,
    last_pillar_id, updated_at from rotation_state limit 1`;
  const rot = rows[0] ?? {
    last_platform: 'linkedin', last_ig_format: null, last_li_format: null,
    last_pillar_id: null, updated_at: null,
  };
  const pillars = await getActivePillars();
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
    from posts order by id desc limit 10`;
  const dash: Dashboard = {
    cron: cronStatus(),
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
      id: p.id as number,
      platform: p.platform as string,
      format: p.format as string,
      topic: p.topic as string,
      status: p.status as PostSummary['status'],
      source: p.source as string,
      created_at: (p.created_at as string) ?? new Date().toISOString(),
      pillar_id: (p.pillar_id as number) ?? null,
    })),
  };
  return c.json(dash);
});

// ---------- pillars ----------
api.get('/pillars', async (c) => {
  const rows = await sql`select id, name, description, is_news, active, sort_order
    from pillars order by sort_order, id`;
  const pillars: Pillar[] = rows.map((r) => ({
    id: r.id as number, name: r.name as string, description: r.description as string,
    is_news: r.is_news as boolean, active: r.active as boolean, sort_order: r.sort_order as number,
  }));
  return c.json(pillars);
});

api.post('/pillars', async (c) => {
  const parsed = PillarInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'input tak valid', issues: parsed.error.issues }, 400);
  const { name, description, is_news, sort_order } = parsed.data;
  await sql`insert into pillars (name, description, is_news, sort_order)
    values (${name}, ${description}, ${is_news}, ${sort_order})`;
  return c.json({ ok: true }, 201);
});

api.post('/pillars/:id/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'id tak valid' }, 400);
  await sql`update pillars set active = not active where id = ${id}`;
  return c.json({ ok: true });
});

api.delete('/pillars/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'id tak valid' }, 400);
  await sql`delete from pillars where id = ${id}`;
  return c.json({ ok: true });
});

// ---------- cron ----------
api.get('/cron', (c) => c.json(cronStatus()));

api.post('/cron', async (c) => {
  const parsed = CronInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'input tak valid', issues: parsed.error.issues }, 400);
  const { expr, enabled } = parsed.data;
  const { validateCronExpression } = await import('cron');
  let valid = false;
  try {
    const res = validateCronExpression(expr);
    valid = typeof res === 'boolean' ? res : res?.valid === true;
  } catch { valid = false; }
  if (!valid) {
    return c.json({ error: 'ekspresi cron tak valid (butuh 5/6 field, cth "0 7 * * *")' }, 400);
  }
  await sql`update settings set cron_expr = ${expr}, cron_enabled = ${enabled} where true`;
  await refreshCron();
  return c.json(cronStatus());
});

// ---------- posts ----------
api.get('/posts', async (c) => {
  const rows = await sql`select id, platform, format, topic, status, source, created_at, pillar_id
    from posts order by id desc limit 100`;
  const posts: PostSummary[] = rows.map((p) => ({
    id: p.id as number, platform: p.platform as string, format: p.format as string,
    topic: p.topic as string, status: p.status as PostSummary['status'],
    source: p.source as string, created_at: (p.created_at as string) ?? new Date().toISOString(),
    pillar_id: (p.pillar_id as number) ?? null,
  }));
  return c.json(posts);
});

api.get('/posts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'id tak valid' }, 400);
  const [p] = await sql`select id, platform, format, topic, caption, body, status, error, source, created_at, pillar_id
    from posts where id = ${id}`;
  if (!p) return c.json({ error: 'post tidak ada' }, 404);
  const body = JSON.parse(p.body ?? 'null');
  const bodyText = body.body ? body.body
    : body.slides ? body.slides.map((s: { headline: string; body: string }, i: number) => `${i + 1}. ${s.headline}\n${s.body}`).join('\n\n')
    : body.scenes ? body.scenes.map((s: { overlay_text: string; narration: string }, i: number) => `${i + 1}. [${s.overlay_text}] ${s.narration}`).join('\n')
    : JSON.stringify(body);
  const detail: PostDetail = {
    id: p.id as number, platform: p.platform as string, format: p.format as string,
    topic: p.topic as string, status: p.status as PostSummary['status'],
    source: p.source as string, created_at: (p.created_at as string) ?? new Date().toISOString(),
    pillar_id: (p.pillar_id as number) ?? null,
    caption: (p.caption as string) ?? '',
    error: (p.error as string) ?? null,
    body_text: bodyText,
  };
  return c.json(detail);
});

api.post('/posts/:id/resend', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'id tak valid' }, 400);
  enqueue({ kind: 'resend', postId: id });
  return c.json({ ok: true, queued: queueStatus() });
});

// ---------- gen manual ----------
api.post('/gen', async (c) => {
  const raw = await c.req.json().catch(() => ({}));
  const parsed = GenerateInput.safeParse(raw);
  if (!parsed.success) return c.json({ error: 'platform/format tak valid' }, 400);
  const { platform, format } = parsed.data;
  enqueue({
    kind: 'generate',
    forced: platform ? { platform, format } : undefined,
    notifyChat: true,
    source: 'web',
  });
  return c.json({ ok: true, queued: queueStatus() }, 202);
});

// ---------- styles ----------
api.get('/styles', async (c) => {
  const rows = await sql`select id, title, body, platform, created_at
    from style_samples order by id desc limit 50`;
  const styles: StyleSample[] = rows.map((s) => ({
    id: s.id as number, title: s.title as string, body: s.body as string,
    platform: (s.platform as string) ?? null, created_at: s.created_at as string,
  }));
  return c.json(styles);
});

api.post('/styles', async (c) => {
  const parsed = StyleInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'input tak valid', issues: parsed.error.issues }, 400);
  const { title, body, platform } = parsed.data;
  await sql`insert into style_samples (title, body, platform)
    values (${title}, ${body}, ${platform})`;
  return c.json({ ok: true }, 201);
});

api.delete('/styles/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'id tak valid' }, 400);
  await sql`delete from style_samples where id = ${id}`;
  return c.json({ ok: true });
});

// ---------- templates ----------
api.get('/templates', async (c) => {
  const rows = await sql`select id, name, format, is_active, updated_at
    from templates order by id desc limit 50`;
  const templates: Template[] = rows.map((t) => ({
    id: t.id as number, name: t.name as string, format: t.format as TemplateFormat,
    is_active: t.is_active as boolean, updated_at: t.updated_at as string,
  }));
  return c.json(templates);
});

api.post('/templates', async (c) => {
  const parsed = TemplateInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'input tak valid', issues: parsed.error.issues }, 400);
  const { name, format, html, is_active } = parsed.data;
  if (is_active) {
    await sql`update templates set is_active = false where format = ${format}`;
  }
  await sql`insert into templates (name, format, html, is_active)
    values (${name}, ${format}, ${html}, ${is_active})`;
  return c.json({ ok: true }, 201);
});

api.post('/templates/:id/activate', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'id tak valid' }, 400);
  const [t] = await sql`select format from templates where id = ${id}`;
  if (t) {
    await sql`update templates set is_active = false where format = ${t.format}`;
    await sql`update templates set is_active = true where id = ${id}`;
  }
  return c.json({ ok: true });
});

api.delete('/templates/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'id tak valid' }, 400);
  await sql`delete from templates where id = ${id}`;
  return c.json({ ok: true });
});

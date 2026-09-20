// FE admin routes — SSR views.ts + HTMX. Auto-escape via html`` helper (XSS boundary).
// Spec step 7: dashboard, pilar CRUD, cron, posts+resend, styles, templates.
import { Hono } from 'hono';
import { sql, getActivePillars } from './db.ts';
import { enqueue, queueStatus } from './queue.ts';
import { refreshCron, cronStatus } from './cron.ts';
import { nextSlot } from './state.ts';
import {
  dashboardPage, pillarsPage, cronPage, postsPage, postDetailPage,
  stylesPage, templatesPage,
} from './views.ts';
import type { Platform, Format } from './state.ts';

export const admin = new Hono();

// ---------- dashboard ----------
admin.get('/', async (c) => {
  const rows = await sql`select last_platform, last_ig_format, last_li_format,
    last_pillar_id, updated_at from rotation_state limit 1`;
  const rot = rows[0] ?? {
    last_platform: 'linkedin', last_ig_format: null, last_li_format: null,
    last_pillar_id: null, updated_at: null,
  };
  const pillars = await getActivePillars();
  // allowNews=true default: nextSlot menentukan sendiri pilar berita dipakai atau tidak
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
  const posts = await sql`select id, platform, format, topic, status, created_at
    from posts order by id desc limit 10`;
  return c.html(
    dashboardPage({
      cron: cronStatus(),
      queue: queueStatus(),
      rotation: {
        platform: rot.last_platform ?? '—',
        igFormat: rot.last_ig_format ?? null,
        liFormat: rot.last_li_format ?? null,
        pillarId: rot.last_pillar_id ?? null,
        updatedAt: rot.updated_at as string,
      },
      nextSlot: next,
      lastPosts: posts.map((p) => ({
        id: p.id as number,
        platform: p.platform as string,
        format: p.format as string,
        topic: p.topic as string,
        status: p.status as string,
        createdAt: p.created_at as string,
      })),
    }),
  );
});

// ---------- pilar ----------
admin.get('/pillars', async (c) => {
  const rows = await sql`select id, name, description, is_news, active, sort_order
    from pillars order by sort_order, id`;
  return c.html(pillarsPage(rows.map((r) => ({
    id: r.id as number, name: r.name as string, description: r.description as string,
    is_news: r.is_news as boolean, active: r.active as boolean, sort_order: r.sort_order as number,
  }))));
});

admin.post('/pillars', async (c) => {
  const f = await c.req.parseBody();
  const name = String(f.name ?? '').trim();
  const description = String(f.description ?? '').trim();
  if (!name || !description) return c.text('nama & deskripsi wajib', 400);
  await sql`insert into pillars (name, description, is_news, sort_order)
    values (${name}, ${description}, ${f.is_news === '1'}, ${Number(f.sort_order ?? 0) || 0})`;
  return c.redirect('/admin/pillars');
});

admin.post('/pillars/:id/toggle', async (c) => {
  const id = Number(c.req.param('id'));
  await sql`update pillars set active = not active where id = ${id}`;
  return c.redirect('/admin/pillars');
});

admin.post('/pillars/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  await sql`delete from pillars where id = ${id}`;
  return c.redirect('/admin/pillars');
});

// ---------- cron ----------
admin.get('/cron', async (c) => {
  const rows = await sql`select cron_expr, cron_enabled from settings limit 1`;
  const s = rows[0]!;
  return c.html(cronPage({ expr: s.cron_expr as string, enabled: s.cron_enabled as boolean }));
});

admin.post('/cron', async (c) => {
  const f = await c.req.parseBody();
  const expr = String(f.expr ?? '').trim();
  // validasi beneran via lib cron — jangan simpan expr yang bikin CronJob throw.
  // validateCronExpression THROW pada input buruk, bukan return false.
  const { validateCronExpression } = await import('cron');
  let valid = false;
  try {
    const res = validateCronExpression(expr);
    valid = typeof res === 'boolean' ? res : res?.valid === true;
  } catch {
    valid = false;
  }
  if (!valid) {
    return c.text('ekspresi cron tak valid (butuh 5/6 field, cth "0 7 * * *")', 400);
  }
  await sql`update settings set cron_expr = ${expr}, cron_enabled = ${f.enabled === '1'} where true`;
  await refreshCron();
  return c.redirect('/admin/cron');
});

// ---------- posts ----------
admin.get('/posts', async (c) => {
  const rows = await sql`select id, platform, format, topic, caption, status, error, source, created_at, pillar_id
    from posts order by id desc limit 100`;
  return c.html(postsPage(rows.map((p) => ({
    id: p.id as number, platform: p.platform as string, format: p.format as string,
    topic: p.topic as string, caption: (p.caption as string) ?? '',
    status: p.status as string, error: p.error as string | null, source: p.source as string,
    createdAt: p.created_at as string, pillarId: (p.pillar_id as number) ?? null,
  }))));
});

admin.get('/posts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const [p] = await sql`select id, platform, format, topic, caption, body, status, error, source, created_at, pillar_id
    from posts where id = ${id}`;
  if (!p) return c.text('post tidak ada', 404);
  const body = JSON.parse(p.body ?? 'null');
  const bodyText = body.body ? body.body
    : body.slides ? body.slides.map((s: { headline: string; body: string }, i: number) => `${i + 1}. ${s.headline}\n${s.body}`).join('\n\n')
    : body.scenes ? body.scenes.map((s: { overlay_text: string; narration: string }, i: number) => `${i + 1}. [${s.overlay_text}] ${s.narration}`).join('\n')
    : JSON.stringify(body);
  return c.html(postDetailPage({
    id: p.id as number, platform: p.platform as string, format: p.format as string,
    topic: p.topic as string, caption: (p.caption as string) ?? '',
    status: p.status as string, error: p.error as string | null, source: p.source as string,
    createdAt: p.created_at as string, pillarId: (p.pillar_id as number) ?? null,
  }, bodyText));
});

admin.post('/posts/:id/resend', async (c) => {
  const id = Number(c.req.param('id'));
  enqueue({ kind: 'resend', postId: id });
  return c.redirect(`/admin/posts/${id}`);
});

// ---------- gen manual ----------
admin.post('/gen', async (c) => {
  enqueue({ kind: 'generate', notifyChat: true, source: 'web' });
  return c.redirect('/admin');
});

// ---------- styles ----------
admin.get('/styles', async (c) => {
  const rows = await sql`select id, title, body, platform, created_at
    from style_samples order by id desc limit 50`;
  return c.html(stylesPage(rows.map((s) => ({
    id: s.id as number, title: s.title as string, body: s.body as string,
    platform: (s.platform as string) ?? null, createdAt: s.created_at as string,
  }))));
});

admin.post('/styles', async (c) => {
  const f = await c.req.parseBody();
  const title = String(f.title ?? '').trim();
  const body = String(f.body ?? '').trim();
  const platform = String(f.platform ?? '');
  if (!title || !body) return c.text('judul & isi wajib', 400);
  await sql`insert into style_samples (title, body, platform)
    values (${title}, ${body}, ${platform === '' ? null : platform})`;
  return c.redirect('/admin/styles');
});

admin.post('/styles/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  await sql`delete from style_samples where id = ${id}`;
  return c.redirect('/admin/styles');
});

// ---------- templates ----------
admin.get('/templates', async (c) => {
  const rows = await sql`select id, name, format, is_active, updated_at
    from templates order by id desc limit 50`;
  return c.html(templatesPage(rows.map((t) => ({
    id: t.id as number, name: t.name as string, format: t.format as string,
    is_active: t.is_active as boolean, updatedAt: t.updated_at as string,
  }))));
});

admin.post('/templates', async (c) => {
  const f = await c.req.parseBody();
  const name = String(f.name ?? '').trim();
  const format = String(f.format ?? '');
  const tplHtml = String(f.html ?? '');
  if (!name || !tplHtml) return c.text('nama & HTML wajib', 400);
  if (!['ig-carousel', 'li-carousel', 'reel'].includes(format)) {
    return c.text('format harus ig-carousel|li-carousel|reel', 400);
  }
  if (f.is_active === '1') {
    await sql`update templates set is_active = false where format = ${format}`;
  }
  await sql`insert into templates (name, format, html, is_active)
    values (${name}, ${format}, ${tplHtml}, ${f.is_active === '1'})`;
  return c.redirect('/admin/templates');
});

admin.post('/templates/:id/activate', async (c) => {
  const id = Number(c.req.param('id'));
  const [t] = await sql`select format from templates where id = ${id}`;
  if (t) {
    await sql`update templates set is_active = false where format = ${t.format}`;
    await sql`update templates set is_active = true where id = ${id}`;
  }
  return c.redirect('/admin/templates');
});

admin.post('/templates/:id/delete', async (c) => {
  const id = Number(c.req.param('id'));
  await sql`delete from templates where id = ${id}`;
  return c.redirect('/admin/templates');
});

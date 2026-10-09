// Load the active template PACKAGE from DB (one row = body + cover + CTA), fall back to default.
// Fill tokens + escape HTML.
import { sql } from '../db/pool.ts';
import type { Platform } from '../state.ts';
import type { CarouselOut } from '../schema.ts';

export type SlideHtml = string; // single-slide html, ready for puppeteer

// A template package: body slides + optional cover/CTA pages (null → body fallback).
export type TemplateSet = { body: string; first: string | null; last: string | null };

// Manual cover mode: image model blank OR the literal "empty" — the pipeline pauses and
// asks for a Telegram photo upload instead of generating. Any other value = auto-generate.
// (a group with no cover part in its template never asks, regardless of this setting)
export function isManualCoverMode(imageModel: string): boolean {
  const m = imageModel.trim().toLowerCase();
  return m === '' || m === 'empty';
}

// Sniff actual bytes: auto-generated covers are PNG, Telegram photo uploads are JPEG —
// the data-URI mime must match or some renderers refuse to decode. Default PNG.
export function imageMime(buf: Buffer): 'image/jpeg' | 'image/png' {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return 'image/png';
}

// Tokens: {{headline}} {{body}} {{image}} {{index}} {{total}} — text values escaped.
// {{image}} is a data: URI — NOT escaped (base64 has no escapable chars; skipping keeps htmls small).
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fill(html: string, vars: Record<string, string>, raw: Record<string, string> = {}): string {
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) =>
    k in raw ? raw[k]! : esc(vars[k] ?? ''));
}

// Default template — dark dev theme, 1080x1350, system font. ponytail: user-uploaded custom template via FE (step 8).
const DEFAULT_IG = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1080px; height: 1350px; font-family: -apple-system, 'Helvetica Neue', sans-serif;
    background: #0f1117; color: #e6e8ee; display: flex; flex-direction: column;
    justify-content: center; padding: 90px; }
  .idx { position: absolute; top: 60px; right: 80px; font-size: 34px; color: #6b7280; font-variant-numeric: tabular-nums; }
  h1 { font-size: 76px; line-height: 1.15; font-weight: 800; letter-spacing: -1px; margin-bottom: 44px; }
  p { font-size: 46px; line-height: 1.5; color: #b7bdca; }
  .accent { position: absolute; left: 0; top: 0; width: 16px; height: 1350px; background: linear-gradient(#22c55e, #0ea5e9); }
</style></head>
<body><div class="accent"></div><div class="idx">{{index}}/{{total}}</div><h1>{{headline}}</h1><p>{{body}}</p></body></html>`;

// LinkedIn PDF: A4 landscape-ish 1080x1350 works too — spec says LI carousel = 6-10 page PDF.
// Same visuals, different context. Keep it simple: use the same template.
const DEFAULT_LI = DEFAULT_IG;
const DEFAULT_NEWS = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1080px; height: 1350px; font-family: -apple-system, 'Helvetica Neue', sans-serif;
    background: #080b12; color: #f8fafc; display: flex; flex-direction: column; justify-content: center; padding: 82px; }
  .tag { position: absolute; top: 64px; left: 76px; border: 1px solid #38bdf8; color: #38bdf8; border-radius: 999px; padding: 12px 22px; font-size: 28px; font-weight: 700; letter-spacing: .08em; }
  .idx { position: absolute; top: 68px; right: 76px; font-size: 30px; color: #64748b; font-variant-numeric: tabular-nums; }
  h1 { font-size: 74px; line-height: 1.08; letter-spacing: -2px; margin-bottom: 42px; }
  p { font-size: 42px; line-height: 1.45; color: #cbd5e1; }
  .bar { position: absolute; left: 76px; bottom: 76px; width: 260px; height: 10px; background: linear-gradient(90deg,#38bdf8,#22c55e); border-radius: 999px; }
</style></head><body><div class="tag">NEWS</div><div class="idx">{{index}}/{{total}}</div><h1>{{headline}}</h1><p>{{body}}</p><div class="bar"></div></body></html>`;

// Template package pinned by id (plan slot_override, or the post's own previous
// render) — status-agnostic: a planned template renders even if not "active"
// (the plan IS the authority for that date).
export async function getTemplateSetById(groupId: string, templateId: string): Promise<TemplateSet | null> {
  const [t] = await sql`select html, html_first, html_last from templates
    where id = ${templateId} and group_id = ${groupId}`;
  if (!t) return null;
  return {
    body: t.html as string,
    first: (t.html_first as string | null) ?? null,
    last: (t.html_last as string | null) ?? null,
  };
}

// Active pool for a format: ALL active rows (multiple allowed — variety by design).
// hasCover: a cover image exists for the post → prefer templates that HAVE a cover
// part (only they can show it); pool without cover parts still applies as fallback.
// Avoids the template this group used last for the same platform when the pool > 1,
// so consecutive posts don't look identical. Returns null id = built-in default.
export async function pickTemplateSet(
  platform: Platform,
  groupId: string,
  hasCover = false,
  newsCard = false,
): Promise<{ id: string | null; set: TemplateSet }> {
  const dbFormat = newsCard && platform === 'instagram' ? 'ig-news-card' : platform === 'instagram' ? 'ig-carousel' : 'li-carousel';
  let rows = (await sql`select id, html, html_first, html_last from templates
    where format = ${dbFormat} and is_active and group_id = ${groupId}`) as unknown as { id: string; html: string; html_first: string | null; html_last: string | null }[];
  if (rows.length === 0 && dbFormat === 'ig-news-card') {
    rows = (await sql`select id, html, html_first, html_last from templates
      where format = 'ig-carousel' and is_active and group_id = ${groupId}`) as unknown as { id: string; html: string; html_first: string | null; html_last: string | null }[];
  }
  let pool = rows;
  if (pool.length === 0) {
    return { id: null, set: { body: newsCard && platform === 'instagram' ? DEFAULT_NEWS : platform === 'instagram' ? DEFAULT_IG : DEFAULT_LI, first: null, last: null } };
  }
  if (hasCover) {
    const withCover = pool.filter((r) => r.html_first !== null);
    if (withCover.length > 0) pool = withCover;
  }
  if (pool.length > 1) {
    const [lastUsed] = await sql`select template_id from posts
      where group_id = ${groupId} and platform = ${platform} and template_id is not null
      order by created_at desc limit 1`;
    if (lastUsed?.template_id) {
      const filtered = pool.filter((r) => r.id !== lastUsed.template_id);
      if (filtered.length > 0) pool = filtered; // pool of 1 → same as today, no choice to make
    }
  }
  const t = pool[Math.floor(Math.random() * pool.length)]!;
  return { id: t.id, set: { body: t.html, first: t.html_first ?? null, last: t.html_last ?? null } };
}

// Manual-cover gate: does ANY active template for this platform's format carry a
// cover part? (Pool-aware — with several active templates, one cover-capable row
// is enough for the cover question to make sense.)
export async function anyActiveCoverTemplate(platform: Platform, groupId: string): Promise<boolean> {
  const formats = platform === 'instagram' ? ['ig-carousel', 'ig-news-card'] : ['li-carousel'];
  const r = await sql`select 1 from templates
    where format = any(${formats}::text[]) and is_active and group_id = ${groupId} and html_first is not null limit 1`;
  return r.length > 0;
}

// Build HTML per slide with the package sequence:
//   slide 1 → html_first (ONLY when a cover image is provided — a cover page without
//             its image is a broken promise; fail-safe renders it as a normal body slide)
//   last    → html_last (when present; no image dependency)
//   middle  → body html
// Tutorial slide extras. Templates may place {{step}} {{code}} {{note}} themselves; a template
// that does not mention {{code}} still shows the command via an injected monospace panel
// (a tutorial slide without its command is broken content, not a style choice).
type SlideExtra = { step?: number | null; code?: string | null; note?: string | null; photo_uri?: string | null; photo_credit?: string | null };

export function codePanel(code: string, note: string): string {
  const lines = code.split('\n').map((l) => {
    const m = l.match(/^(\s*\$\s?)(.*)$/);
    return m ? `<span style="color:#4ade80">${esc(m[1]!)}</span>${esc(m[2]!)}` : esc(l);
  }).join('\n');
  const noteHtml = note ? `<div style="margin-top:18px;padding:14px 18px;border-left:6px solid #f59e0b;background:rgba(245,158,11,.12);color:#fde68a;font:500 26px/1.35 -apple-system,'Helvetica Neue',sans-serif;white-space:pre-wrap">${esc(note)}</div>` : '';
  return `<div class="cg-code" style="position:absolute;left:70px;right:70px;bottom:70px;z-index:5">`
    + `<pre style="margin:0;padding:26px 30px;border-radius:14px;background:#0b0f14;border:2px solid #1f2937;color:#e5e7eb;font:500 28px/1.45 'JetBrains Mono','SFMono-Regular',Menlo,monospace;white-space:pre-wrap;word-break:break-word">${lines}</pre>${noteHtml}</div>`;
}

function photoPanel(uri: string, credit: string): string {
  const cap = credit ? `<div style="position:absolute;right:16px;bottom:14px;padding:6px 9px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font:600 18px/1 -apple-system,'Helvetica Neue',sans-serif">${esc(credit)}</div>` : '';
  return `<div class="cg-photo" style="position:absolute;left:70px;right:70px;top:86px;height:430px;border-radius:22px;overflow:hidden;background:#111;z-index:1"><img src="${uri}" style="width:100%;height:100%;object-fit:cover;display:block">${cap}</div>`;
}

function fillSlide(html: string, vars: Record<string, string>, extra: SlideExtra, raw: Record<string, string> = {}): string {
  const code = extra.code?.trim() ?? '';
  const note = extra.note?.trim() ?? '';
  const photo = extra.photo_uri?.trim() ?? '';
  const credit = extra.photo_credit?.trim() ?? '';
  const v = { ...vars, step: extra.step ? String(extra.step) : '', code, note, photo_credit: credit };
  const out = fill(html, v, { ...raw, photo, photo_block: photo ? photoPanel(photo, credit) : '', code_block: code ? codePanel(code, note) : '' });
  // cover page shows the source photo via {{image}} — still needs its credit
  const creditOnly = !photo && credit && !/\{\{\s*photo_credit\s*\}\}/.test(html)
    ? `<div class="cg-credit" style="position:absolute;right:24px;bottom:20px;z-index:6;padding:6px 9px;border-radius:6px;background:rgba(0,0,0,.55);color:#fff;font:600 18px/1 -apple-system,'Helvetica Neue',sans-serif">${esc(credit)}</div>`
    : '';
  const blocks = [
    creditOnly,
    // auto-injected photo sits on top — push the template's text below it so nothing overlaps
    photo && !/\{\{\s*(photo|photo_block)\s*\}\}/.test(html) ? `<style>body{padding-top:560px!important;justify-content:flex-start!important}</style>${photoPanel(photo, credit)}` : '',
    code && !/\{\{\s*(code|code_block)\s*\}\}/.test(html) ? codePanel(code, note) : '',
  ].filter(Boolean).join('');
  return blocks ? (/<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${blocks}</body>`) : out + blocks) : out;
}

export function buildSlides(
  templates: { body: string; first?: string | null; last?: string | null },
  c: { slides: ({ headline: string; body: string } & SlideExtra)[] },
  coverImage?: Buffer,
): SlideHtml[] {
  const total = c.slides.length;
  const last = total - 1;
  const coverUri = coverImage ? `data:${imageMime(coverImage)};base64,${coverImage.toString('base64')}` : undefined;
  return c.slides.map((s, i) => {
    const vars = { headline: s.headline, body: s.body, index: String(i + 1), total: String(total) };
    if (i === 0 && coverUri && templates.first) {
      return fillSlide(templates.first, vars, s, { image: coverUri });
    }
    if (i === last && total >= 2 && templates.last) {
      return fillSlide(templates.last, vars, s);
    }
    return fillSlide(templates.body, vars, s);
  });
}

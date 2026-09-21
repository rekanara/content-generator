// Load the active template PACKAGE from DB (one row = body + cover + CTA), fall back to default.
// Fill tokens + escape HTML.
import { sql } from '../db/pool.ts';
import type { Platform, Format } from '../state.ts';
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

// Active template package for a format. Cover flow: html_first present on the row
// AND a cover image available → slide 1 uses it. Everything null-safe.
export async function getTemplateSet(format: Format, platform: Platform, groupId: string): Promise<TemplateSet> {
  // db format: ig-carousel | li-carousel | reel — pdf (LI) uses li-carousel
  const dbFormat = platform === 'instagram' ? 'ig-carousel' : 'li-carousel';
  const [t] = await sql`select html, html_first, html_last from templates
    where format = ${dbFormat} and is_active and group_id = ${groupId}
    order by updated_at desc limit 1`;
  if (t) {
    return {
      body: t.html as string,
      first: (t.html_first as string | null) ?? null,
      last: (t.html_last as string | null) ?? null,
    };
  }
  const fallback = platform === 'instagram' ? DEFAULT_IG : DEFAULT_LI;
  return { body: fallback, first: null, last: null };
}

// Build HTML per slide with the package sequence:
//   slide 1 → html_first (ONLY when a cover image is provided — a cover page without
//             its image is a broken promise; fail-safe renders it as a normal body slide)
//   last    → html_last (when present; no image dependency)
//   middle  → body html
export function buildSlides(
  templates: { body: string; first?: string | null; last?: string | null },
  c: CarouselOut,
  coverImage?: Buffer,
): SlideHtml[] {
  const total = c.slides.length;
  const last = total - 1;
  const coverUri = coverImage ? `data:${imageMime(coverImage)};base64,${coverImage.toString('base64')}` : undefined;
  return c.slides.map((s, i) => {
    const vars = { headline: s.headline, body: s.body, index: String(i + 1), total: String(total) };
    if (i === 0 && coverUri && templates.first) {
      return fill(templates.first, vars, { image: coverUri });
    }
    if (i === last && total >= 2 && templates.last) {
      return fill(templates.last, vars);
    }
    return fill(templates.body, vars);
  });
}

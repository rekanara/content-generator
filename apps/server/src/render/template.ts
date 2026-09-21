// Load templates from DB (per format × kind), fall back to default. Fill tokens + escape HTML.
// kinds: first = cover page ({{image}} token), last = CTA page, body = middle slides.
import { sql } from '../db/pool.ts';
import type { Platform, Format } from '../state.ts';
import type { CarouselOut } from '../schema.ts';

export type SlideHtml = string; // single-slide html, ready for puppeteer

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

// Active template for (format, kind) — falls back to kind='body' when the specific
// kind isn't configured (backward compatible: zero first/last templates = old behavior).
export async function getTemplateHtml(format: Format, platform: Platform, groupId: string, kind: 'body' | 'first' | 'last' = 'body'): Promise<string> {
  // db format: ig-carousel | li-carousel | reel — pdf (LI) uses li-carousel
  const dbFormat = platform === 'instagram' ? 'ig-carousel' : 'li-carousel';
  if (kind !== 'body') {
    const rows = await sql`select html from templates
      where format = ${dbFormat} and kind = ${kind} and is_active and group_id = ${groupId}
      order by updated_at desc limit 1`;
    if (rows.length > 0) return rows[0]!.html as string;
    // no template of this kind → caller falls back to body behavior
  }
  const rows = await sql`select html from templates
    where format = ${dbFormat} and kind = 'body' and is_active and group_id = ${groupId}
    order by updated_at desc limit 1`;
  if (rows.length > 0) return rows[0]!.html as string;
  return platform === 'instagram' ? DEFAULT_IG : DEFAULT_LI;
}

// Whether a non-body template exists for the format (decides if slide 1 / last get special treatment).
export async function hasKindTemplate(format: Format, platform: Platform, groupId: string, kind: 'first' | 'last'): Promise<boolean> {
  const dbFormat = platform === 'instagram' ? 'ig-carousel' : 'li-carousel';
  const rows = await sql`select 1 from templates
    where format = ${dbFormat} and kind = ${kind} and is_active and group_id = ${groupId} limit 1`;
  return rows.length > 0;
}

// Build HTML per slide with the kind sequence:
//   slide 1 → first template (ONLY when coverImage is provided — a cover page without
//             its image is a broken promise; fail-safe renders it as a normal body slide)
//   last    → last template (when configured; no image dependency)
//   middle  → body template
export function buildSlides(
  templates: { body: string; first?: string; last?: string },
  c: CarouselOut,
  coverImage?: Buffer,
): SlideHtml[] {
  const total = c.slides.length;
  const last = total - 1;
  const coverUri = coverImage ? `data:image/png;base64,${coverImage.toString('base64')}` : undefined;
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

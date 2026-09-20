// Load template aktif dari DB (per format), fallback default. Isi token + escape HTML.
import { sql } from '../db.ts';
import type { Platform, Format } from '../state.ts';
import type { CarouselOut } from '../schema.ts';

export type SlideHtml = string; // html satu slide, siap dikirim ke puppeteer

// Token: {{headline}} {{body}} {{index}} {{total}} — semua di-escape.
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fill(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

// Default template — dark dev theme, 1080x1350, font system. ponytail: user upload template custom via FE (step 8).
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

// LinkedIn PDF: A4 landscape-ish 1080x1350 juga ok — spec bilang carousel LI = PDF 6-10 halaman.
// Sama visual, beda konteks. Simpel: pakai template sama.
const DEFAULT_LI = DEFAULT_IG;

export async function getTemplateHtml(format: Format, platform: Platform, groupId: string): Promise<string> {
  // format db: ig-carousel | li-carousel | reel — pdf (LI) pakai li-carousel
  const dbFormat = platform === 'instagram' ? 'ig-carousel' : 'li-carousel';
  const rows = await sql`select html from templates
    where format = ${dbFormat} and is_active and group_id = ${groupId}
    order by updated_at desc limit 1`;
  if (rows.length > 0) return rows[0]!.html as string;
  return platform === 'instagram' ? DEFAULT_IG : DEFAULT_LI;
}

// Build HTML per slide. Struktur CarouselOut → array html siap screenshot.
export function slidesToHtml(template: string, c: CarouselOut): SlideHtml[] {
  const total = c.slides.length;
  return c.slides.map((s, i) =>
    fill(template, {
      headline: esc(s.headline),
      body: esc(s.body),
      index: String(i + 1),
      total: String(total),
    }),
  );
}

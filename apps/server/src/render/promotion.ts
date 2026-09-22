// Promo render: template (design system: <style> + {{content}} hole) + AI slide fragments.
// Per slide: {{content}} ← fragment, {{image}} ← data-URI (if stored), {{index}}/{{total}}.
// Canvas fixed 1080×1350, overflow hidden — AI cannot break dimensions.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import type { Promotion, PromoSlide } from '@workspace/shared';
import type { GroupCfg } from '../groups.ts';
import { getTemplate } from '../repos/templates.ts';
import { uploadPromotionImage, getArtifactBuffer, artifactExists } from '../storage.ts';
import { imageMime } from './template.ts';

const W = 1080, H = 1350;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export type RenderedPromo = { files: string[]; prefix: string; missingImages: number[] };

export async function renderPromotion(
  promo: Promotion,
  cfg: GroupCfg,
  platform: 'instagram' | 'linkedin',
): Promise<RenderedPromo> {
  if (!promo.content || promo.content.length === 0) throw new Error('promotion has no content');
  const tpl = promo.template_id ? await getTemplate(cfg.id, promo.template_id) : null;
  const dbFormat = platform === 'instagram' ? 'ig-carousel-promo' : 'li-carousel-promo';
  const html = tpl?.html ?? defaultTemplate(dbFormat);
  const total = promo.content.length;
  const prefix = `promotions/${promo.id}/`;
  const outDir = `out/${promo.id}`;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const missingImages: number[] = [];
  const slideHtmls: string[] = [];
  for (let i = 0; i < total; i++) {
    const s = promo.content[i]!;
    let h = html
      .replace(/\{\{\s*content\s*\}\}/g, s.html)
      .replace(/\{\{\s*index\s*\}\}/g, String(i + 1))
      .replace(/\{\{\s*total\s*\}\}/g, String(total));
    if (h.includes('{{image}}')) {
      const file = await findImage(cfg.slug, promo.id, i + 1);
      if (file) {
        const buf = await getArtifactBuffer(file.key);
        h = h.replace(/\{\{\s*image\s*\}\}/g, `data:${imageMime(buf)};base64,${buf.toString('base64')}`);
      } else {
        missingImages.push(i + 1);
        h = h.replace(/\{\{\s*image\s*\}\}/g, ''); // drop the token — broken <img> avoided
      }
    }
    slideHtmls.push(h);
  }

  const browser = await puppeteer.launch();
  const files: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    for (let i = 0; i < slideHtmls.length; i++) {
      await page.setContent(slideHtmls[i]!, { waitUntil: 'load' });
      const file = `${outDir}/slide-${String(i + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
      files.push(file);
    }
    let pdfPath: string | null = null;
    if (platform === 'linkedin') {
      pdfPath = `${outDir}/carousel.pdf`;
      const inner = (h: string) => h.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? h;
      const style = (h: string) => (h.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? '')
        .replace(/\bbody\s*\{/g, '.slide {').replace(/\bbody\s*,/g, '.slide,').replace(/,\s*body\s*\{/g, ', .slide {');
      const combined = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;box-sizing:border-box}.slide{width:${W}px;height:${H}px;overflow:hidden;page-break-after:always;break-after:page}.slide:last-child{page-break-after:auto}</style>${slideHtmls.map((h) => `<style>${style(h)}</style>`).join('')}</head><body>${slideHtmls.map((h) => `<div class="slide">${inner(h)}</div>`).join('')}</body></html>`;
      const pdfPage = await browser.newPage();
      try {
        await pdfPage.setContent(combined, { waitUntil: 'load' });
        await pdfPage.pdf({ path: pdfPath, width: `${W}px`, height: `${H}px`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: false });
      } finally { await pdfPage.close(); }
    }
    const keys: string[] = [];
    for (let i = 0; i < files.length; i++) {
      keys.push(await uploadPromotionImage(cfg.slug, promo.id, files[i]!, `slide-${String(i + 1).padStart(2, '0')}.png`));
    }
    if (pdfPath) keys.push(await uploadPromotionImage(cfg.slug, promo.id, pdfPath, 'carousel.pdf'));
    return { files: keys, prefix, missingImages };
  } finally {
    await browser.close();
  }
}

async function findImage(slug: string, promoId: string, slide: number) {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const key = `${slug}/promotions/${promoId}/slide-${String(slide).padStart(2, '0')}.${ext}`;
    if (await artifactExists(key)) return { key, ext };
    // fallback: uploads made before the prefix fix landed under posts/ — read them
    // so users don't have to re-upload (remove once no legacy uploads remain)
    const legacy = `${slug}/posts/${promoId}/slide-${String(slide).padStart(2, '0')}.${ext}`;
    if (await artifactExists(legacy)) return { key: legacy, ext };
  }
  return null;
}

function defaultTemplate(format: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; background: #0f1117; color: #e6e8ee;
    font-family: -apple-system, 'Helvetica Neue', sans-serif; }
  .accent { position: absolute; left: 0; top: 0; width: 16px; height: ${H}px; background: linear-gradient(#22c55e, #0ea5e9); }
  .idx { position: absolute; top: 60px; right: 80px; font-size: 34px; color: #6b7280; }
  .feature-item, .stack-item, .stat-item { display: block; font-size: 46px; line-height: 1.4;
    color: #b7bdca; margin: 18px 0; padding-left: 36px; position: relative; }
  .feature-item::before { content: '✓'; position: absolute; left: 0; color: #22c55e; }
  .stack-item::before { content: '⧉'; position: absolute; left: 0; color: #0ea5e9; }
  .stat-item::before { content: '★'; position: absolute; left: 0; color: #f59e0b; }
  {{content}}
</style></head><body><div class="accent"></div><div class="idx">{{index}}/{{total}}</div>{{content}}</body></html>`;
}

// CSS vocabulary extracted from a template's <style> — offered to the content LLM.
export function cssVocabOf(html: string): string {
  const classes = [...new Set((html.match(/\.([a-zA-Z][\w-]*)\s*[,{[]/g) ?? [])
    .map((m) => m.replace(/^[.\s]+/, '').replace(/[{,\[]$/, '').trim()))];
  return classes.length ? classes.map((c) => `.${c}`).join(', ') : '(no custom classes — inline styles only)';
}

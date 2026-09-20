// Carousel: HTML per slide → Puppeteer → PNG 1080x1350 (IG) / PDF (LinkedIn).
// Local staging out/<id>/ → upload to MinIO posts/<id>/.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { sql } from '../db/pool.ts';
import type { Platform } from '../state.ts';
import type { CarouselOut } from '../schema.ts';
import { getTemplateHtml, slidesToHtml } from './template.ts';
import { uploadPostArtifact } from '../storage.ts';

const IG_W = 1080, IG_H = 1350;

export type CarouselArtifacts = { files: string[]; prefix: string };

// Render + upload. Returns the uploaded object keys.
export async function renderCarousel(
  postId: string,
  platform: Platform,
  draft: CarouselOut,
  slug: string,
  groupId: string,
): Promise<CarouselArtifacts> {
  const template = await getTemplateHtml('carousel', platform, groupId);
  const htmls = slidesToHtml(template, draft);

  const outDir = `out/${postId}`;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: IG_W, height: IG_H, deviceScaleFactor: 1 });

    const files: string[] = [];
    for (let i = 0; i < htmls.length; i++) {
      await page.setContent(htmls[i]!, { waitUntil: 'load' });
      const file = `${outDir}/slide-${String(i + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: IG_W, height: IG_H } });
      files.push(file);
    }

    // PDF for LinkedIn: join slides into one document — per-page screenshots already exist,
    // smallest approach: re-render all html into a single multi-page page.pdf.
    let pdfPath: string | null = null;
    if (platform === 'linkedin') {
      pdfPath = `${outDir}/carousel.pdf`;
      const combined = htmls
        .map((h) => h.replace('</body></html>', ''))
        .join('<div style="page-break-after: always"></div>')
        .replace('<html><head>', '<html><head>');
      // page.pdf needs one document: setContent combined, page size 1080x1350pt
      const pdfPage = await browser.newPage();
      try {
        await pdfPage.setContent(combined, { waitUntil: 'load' });
        await pdfPage.pdf({
          path: pdfPath,
          width: `${IG_W}px`,
          height: `${IG_H}px`,
          printBackground: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
          preferCSSPageSize: false,
        });
      } finally {
        await pdfPage.close();
      }
    }

    // upload to MinIO
    const keys: string[] = [];
    for (let i = 0; i < files.length; i++) {
      keys.push(await uploadPostArtifact(slug, postId, files[i]!, `slide-${String(i + 1).padStart(2, '0')}.png`));
    }
    if (pdfPath) keys.push(await uploadPostArtifact(slug, postId, pdfPath, 'carousel.pdf'));

    return { files: keys, prefix: `${slug}/posts/${postId}/` };
  } finally {
    await browser.close();
  }
}

// Render + persist status + artifact_prefix. "Persist" split out to keep it testable.
export async function renderAndSave(postId: string, platform: Platform, draft: CarouselOut, slug: string, groupId: string): Promise<CarouselArtifacts> {
  const { files, prefix } = await renderCarousel(postId, platform, draft, slug, groupId);
  await sql`update posts set status = 'rendered', artifact_prefix = ${prefix}
    where id = ${postId}`;
  console.log(`[render] post #${postId}: ${files.length} artifacts → ${prefix}`);
  return { files, prefix };
}

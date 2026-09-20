// Carousel: HTML per slide → Puppeteer → PNG 1080x1350 (IG) / PDF (LinkedIn).
// Staging lokal out/<id>/ → upload MinIO posts/<id>/.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { sql } from '../db.ts';
import type { Platform } from '../state.ts';
import type { CarouselOut } from '../schema.ts';
import { getTemplateHtml, slidesToHtml } from './template.ts';
import { uploadPostArtifact } from '../storage.ts';

const IG_W = 1080, IG_H = 1350;

export type CarouselArtifacts = { files: string[]; prefix: string };

// Render + upload. Return object keys ter-upload.
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

    // PDF utk LinkedIn: gabung slide jadi dokumen — screenshot per halaman sudah ada,
    // cara paling kecil: render ulang semua html ke satu page.pdf multi halaman.
    let pdfPath: string | null = null;
    if (platform === 'linkedin') {
      pdfPath = `${outDir}/carousel.pdf`;
      const combined = htmls
        .map((h) => h.replace('</body></html>', ''))
        .join('<div style="page-break-after: always"></div>')
        .replace('<html><head>', '<html><head>');
      // page.pdf butuh satu dokumen: setContent combined, ukuran halaman 1080x1350pt
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

    // upload MinIO
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

// Render + persist status + artifact_prefix. Bagian "persist" dipisah biar testable.
export async function renderAndSave(postId: string, platform: Platform, draft: CarouselOut, slug: string, groupId: string): Promise<CarouselArtifacts> {
  const { files, prefix } = await renderCarousel(postId, platform, draft, slug, groupId);
  await sql`update posts set status = 'rendered', artifact_prefix = ${prefix}
    where id = ${postId}`;
  console.log(`[render] post #${postId}: ${files.length} artefak → ${prefix}`);
  return { files, prefix };
}

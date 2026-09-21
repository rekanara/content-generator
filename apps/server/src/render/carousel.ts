// Carousel: HTML per slide → Puppeteer → PNG 1080x1350 (IG) / PDF (LinkedIn).
// Local staging out/<id>/ → upload to MinIO posts/<id>/.
// Cover flow: cover.png in MinIO → reuse (rerender never re-pays image API);
// missing + image model configured → generate once + upload; generation failure
// is fail-safe — the post renders without a cover page (body template on slide 1).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { sql } from '../db/pool.ts';
import type { Platform } from '../state.ts';
import type { CarouselOut } from '../schema.ts';
import type { GroupCfg } from '../groups.ts';
import { generateImage } from '../llm.ts';
import { imagePrompt } from '../prompts.ts';
import { getTemplateSet, buildSlides, isManualCoverMode } from './template.ts';
import { uploadPostArtifact, artifactExists, getArtifactBuffer } from '../storage.ts';

const IG_W = 1080, IG_H = 1350;

export type CarouselArtifacts = { files: string[]; prefix: string };

// Thrown when cover generation is REQUIRED but failed — the queue catches it, parks the
// post at awaiting_cover and asks Telegram (upload manually / render without cover).
// Without the flag, generation failure stays fail-safe (render without cover).
export class CoverGenerationError extends Error {
  constructor(public readonly cause: Error) {
    super(`cover generation failed: ${cause.message}`);
    this.name = 'CoverGenerationError';
  }
}

export type RenderOpts = {
  /** throw on generation failure (queue parks + asks) instead of fail-safe */
  coverRequired?: boolean;
  /** render WITHOUT generating a cover (skip button) — a stored cover.png is still reused */
  skipCover?: boolean;
};

// Cover image for the post: reuse from MinIO, else generate + upload. null = no cover.
// Caller must have created out/<id>/ already (staging dir doubles as upload source).
async function getCover(cfg: GroupCfg, postId: string, topic: string, required: boolean, skip: boolean): Promise<Buffer | null> {
  const key = `${cfg.slug}/posts/${postId}/cover.png`;
  if (await artifactExists(key)) {
    // even on skip: a stored cover (e.g. photo uploaded after skipping) is free — use it
    console.log(`[render] cover reused from ${key}`);
    return getArtifactBuffer(key);
  }
  if (skip) return null; // explicit skip — never generate (the skip button must terminate the flow)
  if (isManualCoverMode(cfg.image.model)) return null; // manual flow paused earlier; reaching here = skip path
  try {
    const buf = await generateImage(cfg, imagePrompt(topic));
    const tmp = `out/${postId}/cover.png`;
    writeFileSync(tmp, buf);
    await uploadPostArtifact(cfg.slug, postId, tmp, 'cover.png');
    console.log(`[render] cover generated + saved (${buf.length}B, model=${cfg.image.model})`);
    return buf;
  } catch (e) {
    if (required) throw new CoverGenerationError(e as Error); // queue parks + asks
    console.warn(`[render] cover generation failed — rendering without cover: ${(e as Error).message}`);
    return null; // fail-safe: post still ships, slide 1 uses the body template
  }
}

// Render + upload. Returns the uploaded object keys.
export async function renderCarousel(
  postId: string,
  platform: Platform,
  draft: CarouselOut,
  cfg: GroupCfg,
  opts: RenderOpts = {},
): Promise<CarouselArtifacts> {
  const outDir = `out/${postId}`;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const set = await getTemplateSet('carousel', platform, cfg.id);
  const cover = set.first ? await getCover(cfg, postId, draft.slides[0]?.headline ?? '', !!opts.coverRequired, !!opts.skipCover) : null;
  const htmls = buildSlides(set, draft, cover ?? undefined);

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
      keys.push(await uploadPostArtifact(cfg.slug, postId, files[i]!, `slide-${String(i + 1).padStart(2, '0')}.png`));
    }
    if (pdfPath) keys.push(await uploadPostArtifact(cfg.slug, postId, pdfPath, 'carousel.pdf'));

    return { files: keys, prefix: `${cfg.slug}/posts/${postId}/` };
  } finally {
    await browser.close();
  }
}

// Render + persist status + artifact_prefix. "Persist" split out to keep it testable.
export async function renderAndSave(postId: string, platform: Platform, draft: CarouselOut, cfg: GroupCfg, opts: RenderOpts = {}): Promise<CarouselArtifacts> {
  const { files, prefix } = await renderCarousel(postId, platform, draft, cfg, opts);
  await sql`update posts set status = 'rendered', artifact_prefix = ${prefix}
    where id = ${postId}`;
  console.log(`[render] post #${postId}: ${files.length} artifacts → ${prefix}`);
  return { files, prefix };
}

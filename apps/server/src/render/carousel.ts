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
import { imagePrice } from '../llm-costs.ts';
import { imagePrompt } from '../prompts.ts';
import { getTemplateSetById, pickTemplateSet, buildSlides, isManualCoverMode, imageMime, type TemplateSet } from './template.ts';
import { uploadPostArtifact, artifactExists, getArtifactBuffer } from '../storage.ts';

const IG_W = 1080, IG_H = 1350;

export type CarouselArtifacts = { files: string[]; prefix: string; coverCost: number; coverModel: string | null; templateId: string | null };

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
  /** pinned template (plans slot_override) — renders even if not active; falls back to the active set when deleted */
  templateId?: string;
};

// Cover image for the post: reuse from MinIO, else generate + upload. null = no cover.
// Returns the image + its snapshot cost (attached to the post's llm_usage by the caller —
// render stays adapter-pure; cost bookkeeping belongs to the queue layer).
// Caller must have created out/<id>/ already (staging dir doubles as upload source).
async function getCover(cfg: GroupCfg, postId: string, topic: string, required: boolean, skip: boolean): Promise<{ buf: Buffer; cost: number } | null> {
  const key = `${cfg.slug}/posts/${postId}/cover.png`;
  if (await artifactExists(key)) {
    // even on skip: a stored cover (e.g. photo uploaded after skipping) is free — use it
    console.log(`[render] cover reused from ${key}`);
    return { buf: await getArtifactBuffer(key), cost: 0 };
  }
  if (skip) return null; // explicit skip — never generate (the skip button must terminate the flow)
  if (isManualCoverMode(cfg.image.model)) return null; // manual flow paused earlier; reaching here = skip path
  try {
    const buf = await generateImage(cfg, imagePrompt(topic));
    const tmp = `out/${postId}/cover.png`;
    writeFileSync(tmp, buf);
    await uploadPostArtifact(cfg.slug, postId, tmp, 'cover.png');
    const cost = imagePrice(cfg.image.model).perImage;
    console.log(`[render] cover generated + saved (${buf.length}B, model=${cfg.image.model}, ~$${cost})`);
    return { buf, cost };
  } catch (e) {
    if (required) throw new CoverGenerationError(e as Error); // queue parks + asks
    console.warn(`[render] cover generation failed — rendering without cover: ${(e as Error).message}`);
    return null; // fail-safe: post still ships, slide 1 uses the body template
  }
}

// Source photos stored at research time (news topics with use_source_images): photo-NN.jpg
// → body slides 2..n-1 in order. When the template has no cover page, the stored cover.png
// goes on slide 1 as an inline photo instead (otherwise the lead photo would be lost).
// photo_credit set = the photos came from the article → every photo carries the credit.
async function withSourcePhotos(cfg: GroupCfg, postId: string, draft: CarouselOut, coverInline: boolean, credit: string | null): Promise<CarouselOut & { slides: (CarouselOut['slides'][number] & { photo_uri?: string; photo_credit?: string })[] }> {
  if (!credit) return draft;
  const uri = (b: Buffer) => `data:${imageMime(b)};base64,${b.toString('base64')}`;
  const slides = draft.slides.map((s) => ({ ...s })) as (CarouselOut['slides'][number] & { photo_uri?: string; photo_credit?: string })[];
  const base = `${cfg.slug}/posts/${postId}/`;
  if (slides[0] && await artifactExists(`${base}cover.png`)) {
    if (coverInline) slides[0].photo_uri = uri(await getArtifactBuffer(`${base}cover.png`));
    slides[0].photo_credit = credit; // cover page: credit badge over the {{image}} photo
  }
  for (let i = 1; i < slides.length - 1; i++) {
    const key = `${base}photo-${String(i + 1).padStart(2, '0')}.jpg`;
    if (!(await artifactExists(key))) continue;
    slides[i]!.photo_uri = uri(await getArtifactBuffer(key));
    slides[i]!.photo_credit = credit;
  }
  return { ...draft, slides };
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

  // Template resolution (first match wins):
  //   1. opts.templateId  — pinned by a plan (slot_override): authority for the date
  //   2. post's own id    — rerender stability: the post keeps its visual identity,
  //                         edits to that template row still come through
  //   3. pool pick        — fresh render: random among active templates for the
  //                         format, avoiding the group's last-used one (variety)
  // A dangling id (template deleted) falls through to the next step.
  const [ownRow] = await sql<{ template_id: string | null; is_news: boolean | null; photo_credit: string | null }[]>`select p.template_id, pi.is_news, p.photo_credit
    from posts p left join pillars pi on pi.id = p.pillar_id
    where p.id = ${postId}`;
  const pinnedId = opts.templateId ?? ownRow?.template_id ?? null;
  const pinnedSet = pinnedId ? await getTemplateSetById(cfg.id, pinnedId) : null;
  const picked: { id: string | null; set: TemplateSet } = pinnedSet
    ? { id: pinnedId, set: pinnedSet }
    : await pickTemplateSet(platform, cfg.id, await artifactExists(`${cfg.slug}/posts/${postId}/cover.png`), ownRow?.is_news === true);
  const set = picked.set;
  const cover = set.first ? await getCover(cfg, postId, draft.slides[0]?.headline ?? '', !!opts.coverRequired, !!opts.skipCover) : null;
  const htmls = buildSlides(set, await withSourcePhotos(cfg, postId, draft, !set.first, ownRow?.photo_credit ?? null), cover?.buf);

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

    // PDF for LinkedIn: one multi-page document from the per-slide htmls.
    // Each html is a FULL document (<html><head><style>...<body>...) — combining them
    // naively nests documents and every body ends up stacked on page 1. Extract each
    // slide's <body> inner html, wrap it in a page-sized block (the slide css targets
    // `body { width/height }` — repoint it to the wrapper), and break pages explicitly.
    let pdfPath: string | null = null;
    if (platform === 'linkedin') {
      pdfPath = `${outDir}/carousel.pdf`;
      const bodyInner = (h: string) => {
        const m = h.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return m?.[1] ?? h;
      };
      // slide templates style `body {width:1080px;height:1350px}` — for the combined
      // document each slide lives in a .slide div; translate those body rules onto it.
      const styleFor = (h: string) => {
        const m = h.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
        return m?.[1]
          ?.replace(/\bbody\s*\{/g, '.slide {')
          .replace(/\bbody\s*,/g, '.slide,')
          .replace(/,\s*body\s*\{/g, ', .slide {') ?? '';
      };
      const pages = htmls.map((h) =>
        `<div class="slide">${bodyInner(h)}</div>`);
      const combined = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  .slide { width: ${IG_W}px; height: ${IG_H}px; overflow: hidden; page-break-after: always; break-after: page; }
  .slide:last-child { page-break-after: auto; break-after: auto; }
</style>${htmls.map((h) => `<style>${styleFor(h)}</style>`).join('')}</head>
<body>${pages.join('')}</body></html>`;
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

    return { files: keys, prefix: `${cfg.slug}/posts/${postId}/`, coverCost: cover?.cost ?? 0, coverModel: cover ? cfg.image.model : null, templateId: picked.id };
  } finally {
    await browser.close();
  }
}

// Render + persist status + artifact_prefix + the chosen template id (rerender
// stability). "Persist" split out to keep it testable.
export async function renderAndSave(postId: string, platform: Platform, draft: CarouselOut, cfg: GroupCfg, opts: RenderOpts = {}): Promise<CarouselArtifacts> {
  const r = await renderCarousel(postId, platform, draft, cfg, opts);
  await sql`update posts set status = 'rendered', artifact_prefix = ${r.prefix},
    template_id = coalesce(${r.templateId}, template_id)
    where id = ${postId}`;
  console.log(`[render] post #${postId}: ${r.files.length} artifacts → ${r.prefix} (template ${r.templateId ? r.templateId.slice(0, 8) : 'default'})`);
  return r;
}

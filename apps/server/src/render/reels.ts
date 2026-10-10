// Reels: scene TTS → ffprobe duration → [Remotion animated video + narration mux | legacy PNG frames → MP4 segments → concat].
// Remotion is the default (REELS_RENDERER); any failure there falls back to legacy so the post still ships.
// Local staging out/<id>/ → upload to MinIO posts/<id>/.
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer';
import { sql } from '../db/pool.ts';
import { sceneVisual, type ReelsOut } from '../schema.ts';
import { tutorialSceneVisual, type TutorialReelsOut } from '../tutorial.ts';
import { ttsToFile, type WordTiming } from '../tts.ts';
import type { GroupCfg } from '../groups.ts';
import { ffprobeDurationArgs, segmentArgs, concatArgs, audioConcatArgs, muxArgs, sfxMixArgs } from './ffmpeg.ts';
import { sfxPlan } from '@workspace/reels/sfx';
import { config } from '../config.ts';
import { buildTimeline } from '@workspace/reels/timeline';
import { parseTheme } from '@workspace/reels/theme';
import { renderRemotionVideo, type BackgroundFile, type PublicAsset } from './remotion.ts';
import { uploadPostArtifact, uploadPostArtifactBuffer, artifactExists, getArtifactBuffer } from '../storage.ts';
import { findLicensedImage } from '../image-search.ts';

export const exec = promisify(execFile);
export const SFX_DIR = resolve(import.meta.dirname, '../../assets/sfx');
const REEL_W = 1080, REEL_H = 1920;

// Default reel template — dark dev theme 1080x1920. Tokens: {{overlay}} {{index}} {{total}}.
// ponytail: user-uploaded custom template via FE (step 8).
const DEFAULT_REEL = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1080px; height: 1920px; font-family: -apple-system, 'Helvetica Neue', sans-serif;
    background: #0f1117; color: #e6e8ee; display: flex; flex-direction: column;
    align-items: center; justify-content: center; padding: 120px; text-align: center; }
  .idx { position: absolute; top: 90px; right: 100px; font-size: 40px; color: #6b7280; font-variant-numeric: tabular-nums; }
  .overlay { font-size: 88px; line-height: 1.2; font-weight: 800; letter-spacing: -1px; }
  .accent { position: absolute; left: 0; top: 0; width: 16px; height: 1920px; background: linear-gradient(#22c55e, #0ea5e9); }
</style></head>
<body><div class="accent"></div><div class="idx">{{index}}/{{total}}</div><div class="overlay">{{overlay}}</div></body></html>`;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function getReelTemplate(groupId: string): Promise<string> {
  // reels are scene-based: one html per template, html_first/html_last unused
  const rows = await sql`select html from templates
    where format = 'reel' and is_active and group_id = ${groupId}
    order by updated_at desc limit 1`;
  return rows.length > 0 ? (rows[0]!.html as string) : DEFAULT_REEL;
}

export async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ffprobeDurationArgs(file));
  const d = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`invalid duration for ${file}: "${stdout.trim()}"`);
  return d;
}

type Audio = { mp3: string; dur: number; words: WordTiming[] };

// Theme JSON lives in the reel template row's html. Pinned id (news topic / post's own) wins,
// even if inactive; dangling/absent → latest active reel template → defaults.
export async function getReelTheme(groupId: string, pinnedId: string | null): Promise<{ id: string | null; theme: ReturnType<typeof parseTheme> }> {
  const pinned = pinnedId ? await sql`select id, html from templates
    where id = ${pinnedId} and format = 'reel' and group_id = ${groupId}` : [];
  const rows = pinned.length ? pinned : await sql`select id, html from templates
    where format = 'reel' and is_active and group_id = ${groupId}
    order by updated_at desc limit 1`;
  const row = rows[0];
  try { return { id: (row?.id as string) ?? null, theme: parseTheme(row ? JSON.parse(row.html as string) : null) }; }
  catch { return { id: (row?.id as string) ?? null, theme: parseTheme(null) }; }
}

// Uploaded reel background (Telegram cover step): video wins over image. Downloaded next to the render.
async function getBackground(cfg: GroupCfg, postId: string, outDir: string): Promise<BackgroundFile | undefined> {
  for (const [file, type] of [['cover.mp4', 'video'], ['cover.png', 'image'], ['photo-01.jpg', 'image']] as const) {
    const key = `${cfg.slug}/posts/${postId}/${file}`;
    if (!(await artifactExists(key))) continue;
    const path = `${outDir}/bg-${file}`;
    await writeFile(path, await getArtifactBuffer(key));
    console.log(`[reels] background ${type} from ${key}`);
    return { type, path };
  }
  return undefined;
}

// Per-scene licensed photo from the writer's image_query. Stored in MinIO (scene-NN.jpg + .txt credit) so a
// rerender reuses the same photo instead of re-searching. Best-effort: any miss = scene renders without photo.
// ponytail: skips stat/cta scenes; add a per-scene upload UI if auto-search quality isn't enough.
async function getSceneImages(cfg: GroupCfg, postId: string, draft: ReelsOut, outDir: string): Promise<(PublicAsset & { credit: string } | null)[]> {
  return Promise.all(draft.scenes.map(async (sc, i) => {
    const q = sc.image_query?.trim();
    if (!q || sc.visual === 'stat' || sc.visual === 'cta') return null;
    try {
      const n = String(i + 1).padStart(2, '0');
      const base = `${cfg.slug}/posts/${postId}/scene-${n}`;
      let buf: Buffer; let credit: string;
      if (await artifactExists(`${base}.jpg`) && await artifactExists(`${base}.txt`)) {
        buf = await getArtifactBuffer(`${base}.jpg`);
        credit = (await getArtifactBuffer(`${base}.txt`)).toString('utf8');
      } else {
        const found = await findLicensedImage(q);
        if (!found) return null;
        buf = found.buf; credit = found.credit;
        await uploadPostArtifactBuffer(cfg.slug, postId, buf, `scene-${n}.jpg`);
        await uploadPostArtifactBuffer(cfg.slug, postId, Buffer.from(credit), `scene-${n}.txt`);
      }
      const path = `${outDir}/scene-${n}.jpg`;
      await writeFile(path, buf);
      return { path, name: `reel-${postId.slice(0, 8)}-scene-${n}.jpg`, credit };
    } catch (e) {
      console.warn(`[reels] scene ${i + 1} image skipped: ${(e as Error).message.slice(0, 160)}`);
      return null;
    }
  }));
}

async function renderWithRemotion(
  cfg: GroupCfg, draft: ReelsOut, audios: Audio[], outDir: string, finalMp4: string, theme: ReturnType<typeof parseTheme>,
  bg: BackgroundFile | undefined, postId: string,
): Promise<void> {
  const imgs = await getSceneImages(cfg, postId, draft, outDir);
  const isTutorial = draft.scenes.some((sc) => 'step' in sc || 'code' in sc || 'note' in sc);
  const timeline = buildTimeline(draft.scenes.map((sc, i) => ({
    overlay_text: sc.overlay_text, narration: sc.narration, durationSec: audios[i]!.dur,
    visual: isTutorial ? tutorialSceneVisual(sc as TutorialReelsOut['scenes'][number], i, draft.scenes.length) : sceneVisual(sc.visual), words: audios[i]!.words,
    step: (sc as TutorialReelsOut['scenes'][number]).step,
    code: (sc as TutorialReelsOut['scenes'][number]).code,
    note: (sc as TutorialReelsOut['scenes'][number]).note,
    image: imgs[i]?.name,
    image_credit: imgs[i]?.credit,
  })));
  const silent = `${outDir}/video-silent.mp4`;
  await renderRemotionVideo(timeline, theme, silent, bg, postId, imgs.filter((x): x is NonNullable<typeof x> => !!x));
  const listFile = `${outDir}/audio-concat.txt`;
  await writeFile(listFile, audios.map((a) => `file '${resolve(a.mp3)}'`).join('\n'), 'utf8');
  const narration = `${outDir}/narration.m4a`;
  await exec('ffmpeg', audioConcatArgs(listFile, narration));
  let track = narration;
  try {
    const mixed = `${outDir}/narration-sfx.m4a`;
    const cues = sfxPlan(timeline).map((c) => ({ ...c, file: resolve(SFX_DIR, c.file) }));
    await exec('ffmpeg', sfxMixArgs(narration, cues, mixed));
    track = mixed;
  } catch (e) {
    console.warn(`[reels] sfx mix skipped: ${(e as Error).message.slice(0, 160)}`);
  }
  await exec('ffmpeg', muxArgs(silent, track, finalMp4));
}

async function renderLegacy(
  template: string, draft: ReelsOut, audios: Audio[], outDir: string, finalMp4: string,
): Promise<void> {
  const total = draft.scenes.length;
  // PNG frame per scene
  const browser = await puppeteer.launch();
  const frames: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: REEL_W, height: REEL_H, deviceScaleFactor: 1 });
    for (let i = 0; i < total; i++) {
      const html = template
        .replace(/\{\{\s*overlay\s*\}\}/g, esc(draft.scenes[i]!.overlay_text))
        .replace(/\{\{\s*index\s*\}\}/g, String(i + 1))
        .replace(/\{\{\s*total\s*\}\}/g, String(total));
      await page.setContent(html, { waitUntil: 'load' });
      const png = `${outDir}/frame-${String(i + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: png, clip: { x: 0, y: 0, width: REEL_W, height: REEL_H } });
      frames.push(png);
    }
  } finally {
    await browser.close();
  }
  // MP4 segment per scene (PNG + audio, duration = audio)
  const segments: string[] = [];
  for (let i = 0; i < total; i++) {
    const seg = `${outDir}/seg-${String(i + 1).padStart(2, '0')}.mp4`;
    await exec('ffmpeg', segmentArgs(frames[i]!, audios[i]!.mp3, audios[i]!.dur, seg));
    segments.push(seg);
  }
  // concat demuxer resolves paths relative to the LIST FILE's directory, not cwd → absolute.
  const listFile = `${outDir}/concat.txt`;
  await writeFile(listFile, segments.map((s) => `file '${resolve(s)}'`).join('\n'), 'utf8');
  await exec('ffmpeg', concatArgs(listFile, finalMp4));
}

export type ReelsArtifacts = { video: string; prefix: string; durationSec: number; templateId: string | null };

export async function renderReels(postId: string, draft: ReelsOut, cfg: GroupCfg, templateId?: string): Promise<ReelsArtifacts> {
  const total = draft.scenes.length;
  const template = await getReelTemplate(cfg.id);
  const outDir = `out/${postId}`;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 1. TTS per scene + duration
  const audios: Audio[] = [];
  for (let i = 0; i < total; i++) {
    const mp3 = `${outDir}/audio-${String(i + 1).padStart(2, '0')}.mp3`;
    const words = await ttsToFile(cfg, draft.scenes[i]!.narration, mp3);
    const dur = await ffprobeDuration(mp3);
    audios.push({ mp3, dur, words });
    console.log(`[reels] scene ${i + 1}/${total}: TTS ${dur.toFixed(1)}s, ${words.length} word timings`);
  }
  const totalDur = audios.reduce((a, b) => a + b.dur, 0);
  if (totalDur < 10 || totalDur > 35) throw new Error(`total duration ${totalDur.toFixed(1)}s outside 15-30s (tolerance)`);
  // spec: 15–30 seconds; hard fail when far off — so the writer prompt gets rechecked, not a broken video

  // 2-4. video: Remotion (animated) first, legacy (static frames) as the safety net
  const finalMp4 = `${outDir}/reel.mp4`;
  const [own] = await sql<{ template_id: string | null }[]>`select template_id from posts where id = ${postId}`;
  const picked = await getReelTheme(cfg.id, templateId ?? own?.template_id ?? null);
  let done = false;
  if (config.reels.renderer === 'remotion') {
    try {
      await renderWithRemotion(cfg, draft, audios, outDir, finalMp4, picked.theme, await getBackground(cfg, postId, outDir), postId);
      done = true;
    } catch (e) {
      console.warn(`[reels] remotion failed — falling back to legacy renderer: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  if (!done) await renderLegacy(template, draft, audios, outDir, finalMp4);

  // 5. Upload
  const key = await uploadPostArtifact(cfg.slug, postId, finalMp4, 'reel.mp4');
  console.log(`[reels] post #${postId}: MP4 ${totalDur.toFixed(1)}s → ${key}`);
  return { video: key, prefix: `${cfg.slug}/posts/${postId}/`, durationSec: totalDur, templateId: picked.id };
}

export async function renderReelsAndSave(postId: string, draft: ReelsOut, cfg: GroupCfg, templateId?: string): Promise<ReelsArtifacts> {
  const r = await renderReels(postId, draft, cfg, templateId);
  await sql`update posts set status = 'rendered', artifact_prefix = ${r.prefix},
    template_id = coalesce(${r.templateId}, template_id) where id = ${postId}`;
  return r;
}

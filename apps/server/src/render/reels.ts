// Reels: scene TTS → ffprobe duration → PNG frame → MP4 segment → concat → final MP4.
// Local staging out/<id>/ → upload to MinIO posts/<id>/.
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer';
import { sql } from '../db/pool.ts';
import type { ReelsOut } from '../schema.ts';
import { ttsToFile } from '../tts.ts';
import type { GroupCfg } from '../groups.ts';
import { ffprobeDurationArgs, segmentArgs, concatArgs } from './ffmpeg.ts';
import { uploadPostArtifact } from '../storage.ts';

const exec = promisify(execFile);
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
  const rows = await sql`select html from templates where format = 'reel' and is_active and group_id = ${groupId}
    order by updated_at desc limit 1`;
  return rows.length > 0 ? (rows[0]!.html as string) : DEFAULT_REEL;
}

async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ffprobeDurationArgs(file));
  const d = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`invalid duration for ${file}: "${stdout.trim()}"`);
  return d;
}

export type ReelsArtifacts = { video: string; prefix: string; durationSec: number };

export async function renderReels(postId: string, draft: ReelsOut, cfg: GroupCfg): Promise<ReelsArtifacts> {
  const total = draft.scenes.length;
  const template = await getReelTemplate(cfg.id);
  const outDir = `out/${postId}`;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 1. TTS per scene + duration
  const audios: { mp3: string; dur: number }[] = [];
  for (let i = 0; i < total; i++) {
    const mp3 = `${outDir}/audio-${String(i + 1).padStart(2, '0')}.mp3`;
    await ttsToFile(cfg, draft.scenes[i]!.narration, mp3);
    const dur = await ffprobeDuration(mp3);
    audios.push({ mp3, dur });
    console.log(`[reels] scene ${i + 1}/${total}: TTS ${dur.toFixed(1)}s`);
  }
  const totalDur = audios.reduce((a, b) => a + b.dur, 0);
  if (totalDur < 10 || totalDur > 35) throw new Error(`total duration ${totalDur.toFixed(1)}s outside 15-30s (tolerance)`);
  // spec: 15–30 seconds; hard fail when far off — so the writer prompt gets rechecked, not a broken video

  // 2. PNG frame per scene
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

  // 3. MP4 segment per scene (PNG + audio, duration = audio)
  const segments: string[] = [];
  for (let i = 0; i < total; i++) {
    const seg = `${outDir}/seg-${String(i + 1).padStart(2, '0')}.mp4`;
    await exec('ffmpeg', segmentArgs(frames[i]!, audios[i]!.mp3, audios[i]!.dur, seg));
    segments.push(seg);
  }

  // 4. Concat → final
  // concat demuxer resolves paths relative to the LIST FILE's directory, not cwd.
  // Our segments are relative to project root → must be absolute.
  const listFile = `${outDir}/concat.txt`;
  await writeFile(listFile, segments.map((s) => `file '${resolve(s)}'`).join('\n'), 'utf8');
  const finalMp4 = `${outDir}/reel.mp4`;
  await exec('ffmpeg', concatArgs(listFile, finalMp4));

  // 5. Upload
  const key = await uploadPostArtifact(cfg.slug, postId, finalMp4, 'reel.mp4');
  console.log(`[reels] post #${postId}: MP4 ${totalDur.toFixed(1)}s → ${key}`);
  return { video: key, prefix: `${cfg.slug}/posts/${postId}/`, durationSec: totalDur };
}

export async function renderReelsAndSave(postId: string, draft: ReelsOut, cfg: GroupCfg): Promise<ReelsArtifacts> {
  const r = await renderReels(postId, draft, cfg);
  await sql`update posts set status = 'rendered', artifact_prefix = ${r.prefix} where id = ${postId}`;
  return r;
}

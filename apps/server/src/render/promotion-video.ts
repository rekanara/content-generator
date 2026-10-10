// Promotion video: AI scenes → Remotion (same ReelsVideo composition as reels) → silent MP4,
// then ffmpeg mixes the audio track: optional TTS narration + SFX cues + looped BGM.
// Theme = latest active reel template of the group (no promo-specific template needed).
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { Promotion } from '@workspace/shared';
import type { GroupCfg } from '../groups.ts';
import { buildTimeline, defaultVisual } from '@workspace/reels/timeline';
import { sfxPlan } from '@workspace/reels/sfx';
import { ttsToFile } from '../tts.ts';
import { uploadPromotionImage } from '../storage.ts';
import { renderRemotionVideo, type PublicAsset } from './remotion.ts';
import { findLicensedImage } from '../image-search.ts';
import { audioConcatArgs, muxArgs, promoAudioArgs } from './ffmpeg.ts';
import { exec, ffprobeDuration, getReelTheme, SFX_DIR } from './reels.ts';

const BGM = resolve(import.meta.dirname, '../../assets/bgm/house-vibez.mp3');

export type PromoVideoPlan = { durationSec: number }[];

export function silentSceneSeconds(visual: string, overlay: string): number {
  const words = overlay.trim().split(/\s+/).filter(Boolean).length;
  const base = visual === 'stat' ? 4.4 : visual === 'cta' ? 4.2 : visual === 'hook' ? 3.4 : 3;
  return Math.min(5.5, base + Math.max(0, words - 5) * 0.18);
}

export async function renderPromotionVideo(
  promo: Promotion, cfg: GroupCfg, opts: { bgm: boolean } = { bgm: true },
): Promise<{ key: string; prefix: string; durationSec: number }> {
  const scenes = promo.video_content;
  if (!scenes || scenes.length === 0) throw new Error('promotion has no video script');
  const voice = promo.video_audio_mode === 'voice';
  const outDir = `out/${promo.id}-video`;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const mp3s: string[] = [];
  const durations: number[] = [];
  const wordsBy: Awaited<ReturnType<typeof ttsToFile>>[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]!;
    if (voice && s.narration.trim()) {
      const mp3 = `${outDir}/audio-${String(i + 1).padStart(2, '0')}.mp3`;
      wordsBy.push(await ttsToFile(cfg, s.narration, mp3));
      mp3s.push(mp3);
      durations.push(Math.max(2.6, (await ffprobeDuration(mp3)) + 0.35));
    } else {
      wordsBy.push([]);
      mp3s.push('');
      durations.push(silentSceneSeconds(s.visual, s.overlay_text));
    }
  }

  const assets: PublicAsset[] = [];
  const sceneImages = await Promise.all(scenes.map(async (s, i) => {
    if (!s.image_query?.trim()) return null;
    const found = await findLicensedImage(s.image_query);
    if (!found) return null;
    const file = `${outDir}/scene-${String(i + 1).padStart(2, '0')}.jpg`;
    const name = `promo-${promo.id.slice(0, 8)}-scene-${String(i + 1).padStart(2, '0')}.jpg`;
    await writeFile(file, found.buf);
    assets.push({ path: file, name });
    return { name, credit: found.credit };
  }));

  const timeline = buildTimeline(scenes.map((s, i) => ({
    overlay_text: s.overlay_text,
    narration: voice ? s.narration : '',
    durationSec: durations[i]!,
    visual: s.visual ?? defaultVisual(i, scenes.length, s.overlay_text),
    words: wordsBy[i]!.length ? wordsBy[i] : undefined,
    image: sceneImages[i]?.name,
    image_credit: sceneImages[i]?.credit,
  })));
  const durationSec = timeline.durationInFrames / timeline.fps;
  if (durationSec > 60) throw new Error(`promo video ${durationSec.toFixed(0)}s is too long`);

  const { theme } = await getReelTheme(cfg.id, null);
  const silent = `${outDir}/video-silent.mp4`;
  await renderRemotionVideo(timeline, voice ? theme : { ...theme, captions: { ...theme.captions, style: 'none' } }, silent, undefined, `promo-${promo.id.slice(0, 8)}`, assets);

  let narration: string | undefined;
  if (voice) {
    const padded: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const out = `${outDir}/pad-${i}.mp3`;
      if (mp3s[i]) {
        await exec('ffmpeg', ['-y', '-i', mp3s[i]!, '-af', `apad=whole_dur=${durations[i]!.toFixed(3)}`, '-t', durations[i]!.toFixed(3), out]);
      } else {
        await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', durations[i]!.toFixed(3), '-c:a', 'libmp3lame', out]);
      }
      padded.push(out);
    }
    const list = `${outDir}/audio-concat.txt`;
    await writeFile(list, padded.map((f) => `file '${resolve(f)}'`).join('\n'), 'utf8');
    narration = `${outDir}/narration.m4a`;
    await exec('ffmpeg', audioConcatArgs(list, narration));
  }

  const track = `${outDir}/track.m4a`;
  const cues = sfxPlan(timeline).map((c) => ({ ...c, file: resolve(SFX_DIR, c.file) }));
  await exec('ffmpeg', promoAudioArgs({ narration, durationSec, cues, bgm: opts.bgm ? BGM : undefined, bgmVolume: voice ? 0.14 : 0.24, out: track }));
  const finalMp4 = `${outDir}/promo.mp4`;
  await exec('ffmpeg', muxArgs(silent, track, finalMp4));

  const key = await uploadPromotionImage(cfg.slug, promo.id, finalMp4, 'promo.mp4');
  console.log(`[promo-video] #${promo.id} ${durationSec.toFixed(1)}s (${voice ? 'voice' : 'silent'}) → ${key}`);
  return { key, prefix: `${cfg.slug}/promotions/${promo.id}/`, durationSec };
}

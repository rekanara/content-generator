// Spike: render a sample reel with Remotion (no DB, no queue).
// Usage (from apps/server): npx tsx scripts/render-reel-sample.ts [background.png|background.mp4]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { buildTimeline, DEFAULT_THEME } from '@workspace/reels';
import { renderRemotionVideo } from '../src/render/remotion.ts';

const entry = resolve(import.meta.dirname, '../../../packages/reels/src/entry.tsx');
const out = resolve('out/remotion-spike/reel.mp4');
mkdirSync(resolve('out/remotion-spike'), { recursive: true });

const timeline = buildTimeline([
  { overlay_text: 'Cuti melahirkan berubah?', narration: 'Aturan baru bikin banyak pekerja bingung soal hak cuti melahirkan.', durationSec: 4 },
  { overlay_text: 'Minimal 3 bulan', narration: 'Hak cuti minimal tiga bulan, dan bisa ditambah bila ada kondisi khusus.', durationSec: 4.5 },
  { overlay_text: 'Upah tetap dibayar', narration: 'Empat bulan pertama dibayar penuh, lalu tujuh puluh lima persen setelahnya.', durationSec: 4.5 },
  { overlay_text: 'Cek kontrakmu', narration: 'Cek kontrak dan tanya HR sebelum jadwal cuti diajukan.', durationSec: 3.5 },
]);
const inputProps = { timeline, theme: { ...DEFAULT_THEME, brand: { handle: '@naratoday', position: 'bottom' as const } } };

const bg = process.argv[2];
if (bg) {
  const t0 = Date.now();
  await renderRemotionVideo(timeline, inputProps.theme, out, { type: /\.(mp4|mov|webm)$/i.test(bg) ? 'video' : 'image', path: resolve(bg) }, 'sample');
  console.log(`render with background ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out}`);
} else {
  const t0 = Date.now();
  const serveUrl = await bundle({ entryPoint: entry });
  console.log('bundled', serveUrl);
  const t1 = Date.now();
  const composition = await selectComposition({ serveUrl, id: 'Reel', inputProps, chromeMode: 'chrome-for-testing', gl: 'angle' });
  await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: out, inputProps, muted: true, concurrency: 2, chromeMode: 'chrome-for-testing', gl: 'angle', licenseKey: 'free-license' });
  const t2 = Date.now();
  console.log(`bundle ${((t1 - t0) / 1000).toFixed(1)}s · render ${((t2 - t1) / 1000).toFixed(1)}s · ${composition.durationInFrames} frames → ${out}`);
}

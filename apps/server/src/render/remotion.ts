// Reels via Remotion: animated video (silent) from the timeline, narration muxed in by ffmpeg.
// Bundle is built once per process and reused. Called from reels.ts; the queue guarantees
// one render at a time (CPU-bound).
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { ReelsTimeline } from '@workspace/reels/timeline';
import type { ReelsTheme } from '@workspace/reels/theme';

const ENTRY = resolve(import.meta.dirname, '../../../../packages/reels/src/entry.tsx');
// Uploaded backgrounds are copied here; the bundle symlinks it as its public/ dir.
const PUBLIC_DIR = resolve('out/remotion-public');
// Chrome-for-testing: the default headless-shell crashed on macOS (icudtl.dat not found).
const CHROME = { chromeMode: 'chrome-for-testing', gl: 'angle' } as const;

let serveUrl: Promise<string> | null = null;
function getServeUrl(): Promise<string> {
  mkdirSync(PUBLIC_DIR, { recursive: true });
  serveUrl ??= bundle({ entryPoint: ENTRY, publicDir: PUBLIC_DIR, symlinkPublicDir: true }).catch((e) => { serveUrl = null; throw e; });
  return serveUrl;
}

export type BackgroundFile = { type: 'image' | 'video'; path: string };

// Silent MP4 for the timeline. Throws on any Remotion/Chrome failure — caller falls back.
export async function renderRemotionVideo(
  timeline: ReelsTimeline, theme: ReelsTheme, outputLocation: string, bg?: BackgroundFile, key = 'reel',
): Promise<void> {
  const url = await getServeUrl();
  const name = bg ? `${key}-bg${extname(bg.path) || (bg.type === 'video' ? '.mp4' : '.png')}` : null;
  if (bg && name) copyFileSync(bg.path, resolve(PUBLIC_DIR, name));
  try {
    const inputProps = { timeline, theme, ...(bg && name ? { background: { type: bg.type, src: name } } : {}) };
    const composition = await selectComposition({ serveUrl: url, id: 'Reel', inputProps, ...CHROME });
    await renderMedia({
      composition, serveUrl: url, codec: 'h264', outputLocation, inputProps,
      muted: true, concurrency: 2, licenseKey: 'free-license', ...CHROME,
    });
  } finally {
    if (name) rmSync(resolve(PUBLIC_DIR, name), { force: true });
  }
}

import { Composition } from 'remotion';
import { ReelsVideo, type ReelsVideoProps } from './ReelsVideo.tsx';
import { buildTimeline } from './timeline.ts';
import { DEFAULT_THEME } from './theme.ts';

export const demoTimeline = buildTimeline([
  { overlay_text: 'Cuti melahirkan berubah?', narration: 'Aturan baru ini terdengar kecil, tapi dampaknya terasa sampai jadwal keluarga.', durationSec: 4.2 },
  { overlay_text: '6 bulan cuti maksimal', narration: 'Minimal tiga bulan, dan bisa ditambah sampai enam bulan bila ada kondisi khusus.', durationSec: 4.4 },
  { overlay_text: 'Upah tetap dibayar', narration: 'Empat bulan pertama dibayar penuh, setelah itu tujuh puluh lima persen.', durationSec: 4.2 },
  { overlay_text: 'Cek kontrakmu hari ini', narration: 'Simpan sumber resminya, lalu tanya HR sebelum jadwal cuti diajukan.', durationSec: 4.1 },
]);

export const defaultProps: ReelsVideoProps = { timeline: demoTimeline, theme: DEFAULT_THEME };

export function RemotionRoot() {
  return (
    <Composition
      id="Reel"
      component={ReelsVideo}
      durationInFrames={demoTimeline.durationInFrames}
      fps={demoTimeline.fps}
      width={demoTimeline.width}
      height={demoTimeline.height}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.timeline.durationInFrames,
        fps: props.timeline.fps,
        width: props.timeline.width,
        height: props.timeline.height,
      })}
    />
  );
}

export { ReelsVideo } from './ReelsVideo.tsx';
export type { ReelsBackground } from './ReelsVideo.tsx';
export { buildTimeline, sceneAtFrame, activeWord, wordsForScene, wordsFromTimings, defaultVisual } from './timeline.ts';
export type { ReelsTimeline, TimelineSceneInput, SceneVisual } from './timeline.ts';
export { ReelsTheme, DEFAULT_THEME, parseTheme } from './theme.ts';
export type { ReelsTheme as ReelsThemeType } from './theme.ts';
export { FONT_CATALOG, loadReelFont } from './fonts.ts';
export type { FontEntry } from './fonts.ts';
export { PRESETS, PRESET_ORDER } from './presets.ts';

import type { ReelsTimeline, TimelineScene } from './timeline.ts';
import { odoLockFrame, statParts } from './odometer.ts';

export type SfxCue = { atSec: number; file: string; volume: number };

export function slamHit(len: number): number {
  return Math.min(8, Math.floor(len * 0.22));
}

export function slamSceneIndex(scenes: TimelineScene[]): number | undefined {
  return scenes.find((s) => s.visual === 'stat')?.index;
}

export function sfxPlan(t: ReelsTimeline): SfxCue[] {
  const cues: SfxCue[] = [];
  const at = (frame: number) => Math.max(0, frame / t.fps);
  const statIdx = slamSceneIndex(t.scenes);
  for (const s of t.scenes) {
    const len = s.endFrame - s.startFrame;
    if (s.index > 0) cues.push({ atSec: at(s.startFrame), file: 'whoosh-fast.mp3', volume: 0.32 });
    if (s.index === 0) cues.push({ atSec: at(s.startFrame + slamHit(len)), file: 'impact-zoom-quick.mp3', volume: 0.5 });
    if (s.visual === 'stat' && s.index === statIdx) {
      cues.push({ atSec: at(s.startFrame + slamHit(len)), file: 'bass-hit-short.mp3', volume: 0.45 });
      const parts = statParts(s.overlay_text);
      if (parts) {
        const lock = Math.min(odoLockFrame(parts.digits - 1), Math.max(8, Math.floor(len * 0.7)));
        for (let i = 0; i < parts.digits; i++) {
          const f = Math.min(odoLockFrame(i), lock);
          if (f < len) cues.push({ atSec: at(s.startFrame + f), file: 'clock-tick-single.mp3', volume: 0.22 });
        }
      }
    }
    if (s.visual === 'step') cues.push({ atSec: at(s.startFrame + 3), file: 'ui-select-click.mp3', volume: 0.35 });
    if (s.visual === 'code') cues.push({ atSec: at(s.startFrame + 4), file: 'typewriter-hit-soft.mp3', volume: 0.3 });
    if (s.visual === 'cta') cues.push({ atSec: at(s.startFrame + 6), file: 'sparkle-touch.mp3', volume: 0.3 });
  }
  return cues.sort((a, b) => a.atSec - b.atSec);
}

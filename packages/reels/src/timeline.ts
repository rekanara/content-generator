// Pure timeline math: scenes (+ audio durations, optional spoken word timings) → frames.
export type SceneVisual = 'hook' | 'point' | 'stat' | 'quote' | 'cta';
export type SpokenWord = { text: string; start: number; end: number };
export type TimelineSceneInput = {
  overlay_text: string;
  narration: string;
  durationSec: number;
  visual?: SceneVisual;
  words?: SpokenWord[]; // seconds from scene start (TTS WordBoundary); absent → spread evenly
};
export type TimelineWord = { text: string; startFrame: number; endFrame: number };
export type TimelineScene = Omit<TimelineSceneInput, 'words'> & {
  index: number;
  visual: SceneVisual;
  startFrame: number;
  endFrame: number;
  words: TimelineWord[];
};
export type ReelsTimeline = { fps: number; width: number; height: number; durationInFrames: number; scenes: TimelineScene[] };

const WORD_RE = /[^\s]+/g;

export function wordsForScene(text: string, startFrame: number, endFrame: number): TimelineWord[] {
  const words = text.match(WORD_RE) ?? [];
  if (words.length === 0) return [];
  const span = Math.max(1, endFrame - startFrame);
  return words.map((word, i) => {
    const a = startFrame + Math.floor((span * i) / words.length);
    const b = startFrame + Math.floor((span * (i + 1)) / words.length);
    return { text: word, startFrame: a, endFrame: Math.max(a + 1, b) };
  });
}

// Spoken timings → frames. Each word holds until the next starts (no flicker in pauses);
// the last one holds to scene end. Clamped inside the scene.
export function wordsFromTimings(spoken: SpokenWord[], startFrame: number, endFrame: number, fps: number): TimelineWord[] {
  const clean = spoken.filter((w) => w.text.trim()).sort((a, b) => a.start - b.start);
  return clean.map((w, i) => {
    const a = Math.min(endFrame - 1, startFrame + Math.max(0, Math.round(w.start * fps)));
    const next = clean[i + 1];
    const b = next ? Math.min(endFrame, startFrame + Math.round(next.start * fps)) : endFrame;
    return { text: w.text, startFrame: a, endFrame: Math.max(a + 1, b) };
  });
}

// Scene visual: explicit from the writer, else first = hook, last = cta, a number-led overlay = stat.
export function defaultVisual(i: number, total: number, overlay: string): SceneVisual {
  if (i === 0) return 'hook';
  if (i === total - 1 && total > 1) return 'cta';
  if (/^\s*[\d.,]+\s*(%|x|rb|jt|juta|ribu|m|k|bulan|hari|tahun)?\b/i.test(overlay)) return 'stat';
  return 'point';
}

export function buildTimeline(scenes: TimelineSceneInput[], fps = 30, width = 1080, height = 1920): ReelsTimeline {
  let cursor = 0;
  const out: TimelineScene[] = scenes.map((scene, index) => {
    const frames = Math.max(1, Math.round(scene.durationSec * fps));
    const startFrame = cursor;
    const endFrame = cursor + frames;
    cursor = endFrame;
    const { words: spoken, ...rest } = scene;
    const words = spoken && spoken.length > 0
      ? wordsFromTimings(spoken, startFrame, endFrame, fps)
      : wordsForScene(scene.narration, startFrame, endFrame);
    return { ...rest, index, visual: scene.visual ?? defaultVisual(index, scenes.length, scene.overlay_text), startFrame, endFrame, words };
  });
  return { fps, width, height, durationInFrames: cursor, scenes: out };
}

export function sceneAtFrame(timeline: ReelsTimeline, frame: number): TimelineScene {
  return timeline.scenes.find((s) => frame >= s.startFrame && frame < s.endFrame) ?? timeline.scenes.at(-1)!;
}

export function activeWord(scene: TimelineScene, frame: number): number {
  return Math.max(0, scene.words.findIndex((w) => frame >= w.startFrame && frame < w.endFrame));
}

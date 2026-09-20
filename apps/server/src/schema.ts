// Type guards for LLM output — trust boundary: anything from the LLM goes through here first.
import type { Format } from './state.ts';

export type IdeationOut = { topic: string; angle: string };
export type Slide = { headline: string; body: string };
export type Scene = { overlay_text: string; narration: string };

export type CarouselOut = { caption: string; slides: Slide[] };
export type ReelsOut = { caption: string; scenes: Scene[] };
export type TextOut = { body: string };

const str = (x: unknown): x is string => typeof x === 'string';
const obj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export function isIdeationOut(x: unknown): x is IdeationOut {
  return obj(x) && str(x.topic) && str(x.angle) && x.topic.length > 0 && x.angle.length > 0;
}

function isSlide(x: unknown): x is Slide {
  return obj(x) && str(x.headline) && str(x.body) && x.headline.length > 0 && x.body.length > 0;
}

function isScene(x: unknown): x is Scene {
  return (
    obj(x) && str(x.overlay_text) && str(x.narration) &&
    x.overlay_text.length > 0 && x.narration.length > 0
  );
}

export function isCarouselOut(x: unknown): x is CarouselOut {
  return (
    obj(x) && str(x.caption) && x.caption.length > 0 &&
    Array.isArray(x.slides) && x.slides.length >= 4 && x.slides.length <= 12 &&
    x.slides.every(isSlide)
  );
}

export function isReelsOut(x: unknown): x is ReelsOut {
  return (
    obj(x) && str(x.caption) && x.caption.length > 0 &&
    Array.isArray(x.scenes) && x.scenes.length >= 4 && x.scenes.length <= 6 &&
    x.scenes.every(isScene)
  );
}

export function isTextOut(x: unknown): x is TextOut {
  return obj(x) && str(x.body) && x.body.length >= 100; // minimum for a decent LinkedIn post
}

// Guard matching the slot format.
export function writerGuard(format: Format): (x: unknown) => boolean {
  if (format === 'reels') return isReelsOut;
  if (format === 'text') return isTextOut;
  return isCarouselOut; // carousel (IG) + pdf (LinkedIn) share the slide structure
}

export function writerGuardName(format: Format): string {
  if (format === 'reels') return 'ReelsOut';
  if (format === 'text') return 'TextOut';
  return 'CarouselOut';
}

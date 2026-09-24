// Type guards for LLM output — trust boundary: anything from the LLM goes through here first.
import type { Format } from './state.ts';

export type IdeationOut = { topic: string; angle: string };
export type Slide = { headline: string; body: string };
export type Scene = { overlay_text: string; narration: string };

// Structured caption (writer output): title required, subtitle/cta optional,
// tags 0-8 (with or without '#', normalized at assembly).
export type CaptionOut = { title: string; subtitle: string; cta: string; tags: string[] };
export type CarouselOut = { caption: CaptionOut; slides: Slide[] };
export type ReelsOut = { caption: CaptionOut; scenes: Scene[] };
export type TextOut = { body: string };

const str = (x: unknown): x is string => typeof x === 'string';
const obj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export function isIdeationOut(x: unknown): x is IdeationOut {
  return obj(x) && str(x.topic) && str(x.angle) && x.topic.length > 0 && x.angle.length > 0;
}

export function isCaptionOut(x: unknown): x is CaptionOut {
  // tolerant: some models answer with the caption as a plain string (old shape) —
  // normalize it into the structured form (title = the string, rest empty) so a
  // good response is never thrown away over a shape nit
  if (typeof x === 'string' && x.trim().length > 0) return true;
  return (
    obj(x) && str(x.title) && x.title.length > 0 &&
    str(x.subtitle) && str(x.cta) &&
    Array.isArray(x.tags) && x.tags.length <= 8 &&
    x.tags.every((t: unknown) => str(t) && t.trim().length > 0 && t.length <= 40)
  );
}

// Coerce a guard-passing caption into the structured shape (string → {title}).
export function toCaptionOut(x: unknown): CaptionOut {
  if (typeof x === 'string') return { title: x.trim(), subtitle: '', cta: '', tags: [] };
  return x as CaptionOut;
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
    obj(x) && isCaptionOut(x.caption) &&
    Array.isArray(x.slides) && x.slides.length >= 4 && x.slides.length <= 12 &&
    x.slides.every(isSlide)
  );
}

export function isReelsOut(x: unknown): x is ReelsOut {
  return (
    obj(x) && isCaptionOut(x.caption) &&
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

// ——— critic scoring gate (pure) ———
// The critic appends "score" (0-10) + "notes" to its revised draft. Guards already
// tolerate extra keys; these helpers read/strip the meta without touching the draft.
// score null (key absent / non-numeric) → gate is OFF for that response (fail-open:
// a scoring hiccup must never block shipping).
export function criticScore(draft: unknown): number | null {
  if (!obj(draft)) return null;
  const s = (draft as Record<string, unknown>).score;
  if (typeof s !== 'number' || !Number.isFinite(s)) return null;
  return Math.max(0, Math.min(10, Math.round(s)));
}

// Remove critic meta keys so the persisted body JSON stays the clean draft shape.
export function stripCriticMeta<T extends object>(draft: T): T {
  const d = { ...draft };
  delete (d as Record<string, unknown>).score;
  delete (d as Record<string, unknown>).notes;
  return d;
}

// Editor feedback line for the retry writer call — notes preferred, score as fallback.
export function criticFeedback(draft: unknown, score: number): string {
  const notes = obj(draft) ? (draft as Record<string, unknown>).notes : undefined;
  const n = typeof notes === 'string' && notes.trim() ? notes.trim() : 'the editor found it below publish quality';
  return `Editor rejected the previous attempt (score ${score}/10): ${n}`;
}

// ——— AI planner output ———
export type PlannerProposal = {
  for_date: string;          // YYYY-MM-DD
  template_id: string;       // must exist in the offered palette
  pillar_id?: string | null; // must be an active pillar when present
  platform?: string | null;  // 'instagram' | 'linkedin'
  format?: string | null;    // slot format
  note: string;              // justification (Indonesian)
};
export type PlannerOut = { plans: PlannerProposal[] };

export function isPlannerOut(x: unknown): x is PlannerOut {
  if (!obj(x) || !Array.isArray(x.plans) || x.plans.length > 8) return false;
  return x.plans.every((p: unknown) => {
    if (!obj(p)) return false;
    if (!str(p.for_date) || !/^\d{4}-\d{2}-\d{2}$/.test(p.for_date)) return false;
    if (!str(p.template_id) || p.template_id.length === 0) return false;
    if (!str(p.note) || p.note.length === 0) return false;
    if (p.pillar_id !== undefined && p.pillar_id !== null && !str(p.pillar_id)) return false;
    if (p.platform !== undefined && p.platform !== null && !['instagram', 'linkedin'].includes(p.platform as string)) return false;
    if (p.format !== undefined && p.format !== null && !['carousel', 'reels', 'pdf', 'text'].includes(p.format as string)) return false;
    return true;
  });
}

// ——— caption assembly (pure) ———
// Structured caption + group footer → the final caption string stored in posts.caption.
// Order: title / subtitle / cta / footer / tags. Empty parts are skipped entirely
// (no blank gaps); footer omitted when the group setting is blank.
// Tags: whitespace-collapsed, '#' guaranteed exactly once, deduped, whitespace/oversized dropped.
export function assembleCaption(c: CaptionOut, footer: string, ctaOverride?: string): string {
  const lines: string[] = [];
  const push = (s: string | undefined) => {
    const v = (s ?? '').trim();
    if (v) lines.push('', v);
  };
  lines.push(c.title.trim());
  push(c.subtitle);
  // group setting wins over the LLM's cta when set — consistent brand voice
  push(ctaOverride && ctaOverride.trim() ? ctaOverride : c.cta);
  const f = footer.trim();
  if (f) lines.push('', f);
  const seen = new Set<string>();
  const tags = (c.tags ?? [])
    .map((t) => {
      const v = t.trim().replace(/^#+/, '');
      return v && !/\s/.test(v) && v.length <= 30 ? `#${v}` : '';
    })
    .filter((t) => t && !seen.has(t) && seen.add(t));
  if (tags.length > 0) lines.push('', tags.join(' '));
  return lines.join('\n').replace(/^\n+/, '').trim();
}

// ——— promotion content (AI-authored slides) ———
export type PromoSlideOut = { html: string; image_prompt: string };
export type PromoContentOut = { slides: PromoSlideOut[] };

export function isPromoContentOut(x: unknown): x is PromoContentOut {
  if (!obj(x) || !Array.isArray(x.slides) || x.slides.length < 4 || x.slides.length > 10) return false;
  return x.slides.every((s: unknown) => {
    if (!obj(s) || !str(s.html) || s.html.length < 10) return false;
    const ip = s.image_prompt;
    return ip === undefined || str(ip);
  });
}

// ——— promotion brief (AI drafts the promo DATA from a rough brief) ———
export type PromoBriefOut = {
  name: string; topic: string; features: string[]; stacks: string[];
  stats: string[]; price: string; price_sale: string;
};
export function isPromoBriefOut(x: unknown): x is PromoBriefOut {
  return (
    obj(x) && str(x.name) && x.name.length > 0 && str(x.topic) &&
    Array.isArray(x.features) && x.features.every(str) &&
    Array.isArray(x.stacks) && x.stacks.every(str) &&
    Array.isArray(x.stats) && x.stats.every(str) &&
    str(x.price) && str(x.price_sale)
  );
}

// Type guards for LLM output — trust boundary: anything from the LLM goes through here first.
import type { Format } from './state.ts';

export type IdeationOut = { topic: string; angle: string };
export type NewsScoreOut = { score: number; reason: string };
// Research step output: concrete facts pulled from the article BEFORE writing.
export type NewsResearchOut = { facts: string[]; reader_scenario: string; open_questions: string[] };
export type NewsAutofillOut = { allowed_domains: string[]; keywords: string[]; sources: { name: string; url: string }[] };
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

export function isNewsScoreOut(x: unknown): x is NewsScoreOut {
  return obj(x) && typeof x.score === 'number' && Number.isFinite(x.score) && x.score >= 0 && x.score <= 100 && str(x.reason) && x.reason.length > 0;
}

export function isNewsResearchOut(x: unknown): x is NewsResearchOut {
  return obj(x) &&
    Array.isArray(x.facts) && x.facts.length >= 1 && x.facts.length <= 10 && x.facts.every((f) => str(f) && f.trim().length > 0) &&
    str(x.reader_scenario) &&
    Array.isArray(x.open_questions) && x.open_questions.every(str);
}

export function isNewsAutofillOut(x: unknown): x is NewsAutofillOut {
  return obj(x) &&
    Array.isArray(x.allowed_domains) && x.allowed_domains.every(str) &&
    Array.isArray(x.keywords) && x.keywords.every(str) &&
    Array.isArray(x.sources) && x.sources.every((s) => obj(s) && str(s.name) && str(s.url));
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
// Trailing hashtag-only lines move into tags — otherwise assembleCaption would put
// CTA/footer AFTER the hashtags (models, the critic especially, often answer this way).
export function toCaptionOut(x: unknown): CaptionOut {
  if (typeof x !== 'string') return x as CaptionOut;
  const lines = x.trim().split('\n');
  const tags: string[] = [];
  while (lines.length > 1 && /^\s*(#[^\s#]+\s*)+$/.test(lines[lines.length - 1]!)) {
    tags.unshift(...lines.pop()!.trim().split(/\s+/));
  }
  return { title: lines.join('\n').trim(), subtitle: '', cta: '', tags: tags.slice(0, 8) };
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

// ——— AI pillar suggestions ———
export type PillarsOut = { pillars: { name: string; description: string; is_news: boolean }[] };
export function isPillarsOut(x: unknown): x is PillarsOut {
  return obj(x) && Array.isArray(x.pillars) && x.pillars.length >= 1 && x.pillars.length <= 10 &&
    x.pillars.every((p: unknown) => obj(p) && str(p.name) && p.name.trim().length > 0 && p.name.length <= 80 &&
      str(p.description) && p.description.trim().length >= 10 && typeof p.is_news === 'boolean');
}

// Referential cleanup: trim, drop names that already exist / repeat (case-insensitive),
// keep at most ONE news pillar (and none if the group already has one), cap 8.
export function cleanPillarSuggestions(out: PillarsOut, existing: { name: string; is_news: boolean }[]): PillarsOut['pillars'] {
  const seen = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  let news = existing.some((p) => p.is_news);
  const res: PillarsOut['pillars'] = [];
  for (const p of out.pillars) {
    const name = p.name.trim();
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (p.is_news && news) continue;
    seen.add(key);
    if (p.is_news) news = true;
    res.push({ name, description: p.description.trim(), is_news: p.is_news });
    if (res.length === 8) break;
  }
  return res;
}

// ——— AI style-sample suggestions ———
export type StyleSuggestOut = { samples: { title: string; body: string; platform: 'instagram' | 'linkedin' | null }[] };
export function isStylesOut(x: unknown): x is StyleSuggestOut {
  return obj(x) && Array.isArray(x.samples) && x.samples.length >= 1 && x.samples.length <= 10 &&
    x.samples.every((s: unknown) => obj(s) && str(s.title) && s.title.trim().length > 0 && s.title.length <= 120 &&
      str(s.body) && s.body.trim().length >= 50 &&
      (s.platform === null || s.platform === 'instagram' || s.platform === 'linkedin'));
}

// Trim, drop titles that already exist / repeat (case-insensitive), cap 6.
export function cleanStyleSuggestions(out: StyleSuggestOut, existing: { title: string }[]): StyleSuggestOut['samples'] {
  const seen = new Set(existing.map((s) => s.title.trim().toLowerCase()));
  const res: StyleSuggestOut['samples'] = [];
  for (const s of out.samples) {
    const title = s.title.trim();
    if (seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    res.push({ title, body: s.body.trim(), platform: s.platform });
    if (res.length === 6) break;
  }
  return res;
}

// ——— override description polish ———
export type PolishOut = { polished: string };
export function isPolishOut(x: unknown): x is PolishOut {
  // floor: a polish that returns LESS than the raw draft's half is almost certainly
  // a refusal or a mistake, not an edit — reject and let the caller keep the raw text
  if (!obj(x) || !str(x.polished) || x.polished.trim().length < 10) return false;
  return true;
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

// ——— caption CTA/footer resolution (pure) ———
// Item override (news topic / override / promotion) wins; blank or null falls back
// to the group Settings value.
export function resolveCaptionParts(
  item: { caption_cta?: string | null; caption_footer?: string | null } | null | undefined,
  group: { captionCta: string; captionFooter: string },
): { cta: string; footer: string } {
  const pick = (own: string | null | undefined, fallback: string) => (own && own.trim() ? own.trim() : fallback);
  return { cta: pick(item?.caption_cta, group.captionCta), footer: pick(item?.caption_footer, group.captionFooter) };
}

// Plain caption text (override/promo: no structured LLM caption) + CTA + footer.
// Idempotent-ish guard: a part already present verbatim is not appended again.
export function appendCaptionParts(text: string, parts: { cta: string; footer: string }, max = 1024): string {
  let out = text.trim();
  for (const p of [parts.cta, parts.footer]) {
    const v = p.trim();
    if (v && !out.includes(v)) out = out ? `${out}\n\n${v}` : v;
  }
  return out.slice(0, max);
}

// ——— news source attribution (pure) ———
// Guarantees the source is visible no matter what the LLM wrote: caption gets the
// full URL (Telegram/IG caption = where Jack copies it from), the last slide gets a
// short "source: domain" credit appended (no dedicated "read the source" slide —
// that is filler), reels name the publisher, text posts end with the link. Idempotent.
export function withNewsSource<T extends object>(d: T, src: { url: string; domain: string }, label = 'Sumber'): T {
  const line = `${label}: ${src.url}`;
  const out = structuredClone(d) as Record<string, unknown>;
  const cap = out.caption as CaptionOut | undefined;
  if (cap && typeof cap === 'object' && !`${cap.subtitle}`.includes(src.url)) {
    cap.subtitle = [cap.subtitle?.trim(), line].filter(Boolean).join('\n\n');
  }
  const slides = out.slides as Slide[] | undefined;
  const last = slides?.[slides.length - 1];
  if (last && !`${last.headline} ${last.body}`.toLowerCase().includes(src.domain.toLowerCase())) {
    last.body = `${last.body.trim()}\n\n${label.toLowerCase()}: ${src.domain}`;
  }
  const scenes = out.scenes as Scene[] | undefined;
  const lastScene = scenes?.[scenes.length - 1];
  if (lastScene && !`${lastScene.overlay_text} ${lastScene.narration}`.toLowerCase().includes(src.domain.toLowerCase())) {
    lastScene.overlay_text = `${lastScene.overlay_text} · ${src.domain}`.slice(0, 80);
  }
  if (typeof out.body === 'string' && !out.body.includes(src.url)) out.body = `${out.body.trim()}\n\n${line}`;
  return out as T;
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

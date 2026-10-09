// Tutorial drafts: shape guards + accuracy checks. Pure — no DB, no network.
// A wrong command breaks the reader's setup, so accuracy is enforced in code, not left to the LLM:
// every command must appear in the fetched official sources (provenance), steps are numbered
// in order, risky commands carry a warning, secrets never ship.
import { isCaptionOut, type CaptionOut } from './schema.ts';

export type TutorialSlide = { headline: string; body: string; step?: number; code?: string; note?: string };
export type TutorialScene = { overlay_text: string; narration: string; visual?: string; step?: number; code?: string; note?: string };
export type TutorialCarouselOut = { caption: CaptionOut; slides: TutorialSlide[] };
export type TutorialReelsOut = { caption: CaptionOut; scenes: TutorialScene[] };
export type TutorialDraft = TutorialCarouselOut | TutorialReelsOut;
export type TutorialFormat = 'carousel' | 'reels';

export const TUTORIAL_LIMITS = {
  carousel: { min: 6, max: 12, codeLines: 10, lineChars: 80 },
  reels: { min: 5, max: 8, codeLines: 6, lineChars: 60, sceneWords: 24, totalWords: 150 },
} as const;

const str = (x: unknown): x is string => typeof x === 'string';
const obj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const optStr = (x: unknown) => x === undefined || x === null || str(x);
const optStep = (x: unknown) => x === undefined || x === null || (typeof x === 'number' && Number.isInteger(x) && x > 0);

function isTutorialSlide(x: unknown): x is TutorialSlide {
  return obj(x) && str(x.headline) && x.headline.trim().length > 0 && str(x.body) && x.body.trim().length > 0
    && optStep(x.step) && optStr(x.code) && optStr(x.note);
}

function isTutorialScene(x: unknown): x is TutorialScene {
  return obj(x) && str(x.overlay_text) && x.overlay_text.trim().length > 0 && str(x.narration) && x.narration.trim().length > 0
    && optStr(x.visual) && optStep(x.step) && optStr(x.code) && optStr(x.note);
}

export function isTutorialCarouselOut(x: unknown): x is TutorialCarouselOut {
  const l = TUTORIAL_LIMITS.carousel;
  return obj(x) && isCaptionOut(x.caption) && Array.isArray(x.slides)
    && x.slides.length >= l.min && x.slides.length <= l.max && x.slides.every(isTutorialSlide);
}

export function isTutorialReelsOut(x: unknown): x is TutorialReelsOut {
  const l = TUTORIAL_LIMITS.reels;
  return obj(x) && isCaptionOut(x.caption) && Array.isArray(x.scenes)
    && x.scenes.length >= l.min && x.scenes.length <= l.max && x.scenes.every(isTutorialScene);
}

export const tutorialGuard = (f: TutorialFormat) => (f === 'reels' ? isTutorialReelsOut : isTutorialCarouselOut);

type Item = { step?: number; code?: string; note?: string; label: string };

function items(d: TutorialDraft): Item[] {
  if ('slides' in d) return d.slides.map((s, i) => ({ step: s.step ?? undefined, code: s.code ?? undefined, note: s.note ?? undefined, label: `slide ${i + 1}` }));
  return d.scenes.map((s, i) => ({ step: s.step ?? undefined, code: s.code ?? undefined, note: s.note ?? undefined, label: `scene ${i + 1}` }));
}

// Collapse whitespace + unify quotes/dashes so "npm  install" in docs matches "npm install".
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

// Shell builtins that never need a source (navigation / trivial inspection).
const TRIVIAL = new Set(['cd', 'ls', 'pwd', 'mkdir', 'cat', 'echo', 'clear', 'exit', 'cp', 'mv', 'touch', 'nano', 'vim', 'code']);
const PLACEHOLDER = /<[A-Za-z0-9_ .-]{1,40}>/g;

// One code line → the literal fragments that must exist in the sources. Prompt markers,
// comments, blank lines, trivial builtins → nothing to check.
export function commandFragments(line: string): string[] {
  const t = line.trim();
  if (!t || t.startsWith('#') || t.startsWith('//')) return [];
  const l = t.replace(/^(\$|>|PS>)\s*/, '');
  if (!l) return [];
  if (TRIVIAL.has(l.split(/\s+/)[0]!)) return [];
  return l.split(PLACEHOLDER).map((f) => f.trim()).filter((f) => f.length >= 3);
}

export function findUnsourcedCommands(d: TutorialDraft, sourceText: string): string[] {
  const hay = normalizeForMatch(sourceText);
  const out: string[] = [];
  for (const it of items(d)) {
    for (const line of (it.code ?? '').split('\n')) {
      const missing = commandFragments(line).filter((f) => !hay.includes(normalizeForMatch(f)));
      if (missing.length) out.push(`${it.label}: "${line.trim().slice(0, 80)}" not found in the official sources`);
    }
  }
  return out;
}

const DANGER = [
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i,
  /\|\s*(sudo\s+)?(ba|z)?sh\b/i,
  /\bsudo\b/i,
  /\bchmod\s+(-R\s+)?777\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bgit\s+push\s+.*--force\b|\bgit\s+reset\s+--hard\b/i,
  /\bdrop\s+(table|database)\b/i,
];

const SECRETS = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(api[_-]?key|token|secret|password)\s*[=:]\s*['"]?(?!<)[A-Za-z0-9_\-/+]{16,}/i,
];

export function findDangerWithoutNote(d: TutorialDraft): string[] {
  return items(d)
    .filter((it) => it.code && DANGER.some((re) => re.test(it.code!)) && !(it.note ?? '').trim())
    .map((it) => `${it.label}: risky command needs a "note" explaining the risk`);
}

export function findSecrets(d: TutorialDraft): string[] {
  const texts = 'slides' in d
    ? d.slides.map((s, i) => [`slide ${i + 1}`, `${s.headline}\n${s.body}\n${s.code ?? ''}\n${s.note ?? ''}`] as const)
    : d.scenes.map((s, i) => [`scene ${i + 1}`, `${s.overlay_text}\n${s.narration}\n${s.code ?? ''}\n${s.note ?? ''}`] as const);
  return texts.filter(([, t]) => SECRETS.some((re) => re.test(t))).map(([label]) => `${label}: looks like a real secret — use a placeholder like <YOUR_API_KEY>`);
}

// Steps present must read 1, 2, 3… in order — no gaps, no repeats.
export function findStepOrderIssues(d: TutorialDraft): string[] {
  const steps = items(d).filter((it) => it.step !== undefined).map((it) => it.step!);
  if (steps.length < 3) return [`only ${steps.length} numbered step(s) — a tutorial needs at least 3`];
  const bad = steps.findIndex((s, i) => s !== i + 1);
  return bad === -1 ? [] : [`step numbers must run 1..${steps.length} in order (got ${steps.join(', ')})`];
}

export function findCodeFitIssues(d: TutorialDraft, format: TutorialFormat): string[] {
  const l = TUTORIAL_LIMITS[format];
  const out: string[] = [];
  for (const it of items(d)) {
    if (!it.code) continue;
    const lines = it.code.split('\n');
    if (lines.length > l.codeLines) out.push(`${it.label}: code has ${lines.length} lines (max ${l.codeLines}) — split the step`);
    const long = lines.find((x) => x.length > l.lineChars);
    if (long) out.push(`${it.label}: code line longer than ${l.lineChars} chars: "${long.slice(0, 40)}…"`);
  }
  return out;
}

// Reels narration is spoken by TTS — commands/flags read aloud are noise; code lives on screen.
export function findNarrationIssues(d: TutorialDraft): string[] {
  if (!('scenes' in d)) return [];
  const l = TUTORIAL_LIMITS.reels;
  const out: string[] = [];
  let total = 0;
  d.scenes.forEach((s, i) => {
    const words = s.narration.trim().split(/\s+/).length;
    total += words;
    if (words > l.sceneWords) out.push(`scene ${i + 1}: narration ${words} words (max ${l.sceneWords})`);
    if (/`|&&|\s--[a-z]|\|\s|\$\s|https?:\/\//i.test(s.narration)) out.push(`scene ${i + 1}: narration contains code/URL — keep code in "code", speak in plain words`);
  });
  if (total > l.totalWords) out.push(`total narration ${total} words (max ${l.totalWords})`);
  return out;
}

export function validateTutorial(d: TutorialDraft, format: TutorialFormat, sourceText: string): string[] {
  return [
    ...findStepOrderIssues(d),
    ...findUnsourcedCommands(d, sourceText),
    ...findDangerWithoutNote(d),
    ...findSecrets(d),
    ...findCodeFitIssues(d, format),
    ...findNarrationIssues(d),
  ];
}

// Reels scene visual for render: explicit step/code wins over the writer's label.
export function tutorialSceneVisual(s: TutorialScene, i: number, total: number): 'hook' | 'step' | 'code' | 'cta' | 'point' {
  if (s.code?.trim()) return 'code';
  if (s.step) return 'step';
  if (i === 0) return 'hook';
  if (i === total - 1) return 'cta';
  return 'point';
}

// Source attribution in code (never left to the LLM): caption lists every source + the
// snapshot date; the last slide names the domains.
export function withTutorialSources<T extends TutorialDraft>(d: T, urls: string[], date: string, lang: string): T {
  const out = structuredClone(d);
  const label = lang === 'id' ? `Berdasarkan dokumentasi resmi per ${date}:` : `Based on the official docs as of ${date}:`;
  const block = [label, ...urls].join('\n');
  if (!out.caption.subtitle.includes(urls[0]!)) out.caption.subtitle = [out.caption.subtitle.trim(), block].filter(Boolean).join('\n\n');
  if ('slides' in out) {
    const last = out.slides[out.slides.length - 1]!;
    const domains = [...new Set(urls.map((u) => new URL(u).hostname.replace(/^www\./, '')))];
    if (!domains.every((dm) => last.body.toLowerCase().includes(dm))) last.body = `${last.body.trim()}\n\n${lang === 'id' ? 'sumber' : 'source'}: ${domains.join(', ')}`;
  }
  return out;
}

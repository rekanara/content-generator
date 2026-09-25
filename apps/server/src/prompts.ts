// Prompt builder — pure functions, unit-testable. Output language follows the pillar.
import type { Format, Platform } from './state.ts';
import type { Slide, Scene, CarouselOut, ReelsOut } from './schema.ts';

type Msg = { role: 'system' | 'user'; content: string };

export type StyleSample = { title: string; body: string; platform: string | null };
export type PillarFull = { id: string; name: string; description: string; is_news: boolean };

const R = 'Reply ONLY with valid JSON, no text outside the JSON.';

function styleBlock(samples: StyleSample[]): string {
  if (samples.length === 0) return 'No style samples yet — write naturally, like a developer sharing experience.';
  return samples
    .map((s, i) => `Sample ${i + 1}:\n${s.title}\n${s.body}`)
    .join('\n\n')
    .slice(0, 6000);
}

function rules(): string {
  return `STRICT RULES (violation = rejected):
- Banned clichés: "in today's digital era", "in today's fast-paced world", "we can't deny", "game changer", "skyrocket". Also the local equivalents in the output language.
- First-line hook must be specific (a number, a concrete moment, or a sharp question) — generic hooks rejected.
- Max 2 emoji per caption; LinkedIn ideally none.
- Casual but sharp — like a developer talking, not corporate, not stiff formal.
- Match the language of the pillar description and style samples.
- No fluff: every sentence carries information.`;
}

export function ideationPrompt(
  p: PillarFull,
  history: string[],
  newsContext: string | null,
  recentTopics: string[] = [],
): Msg[] {
  const hist = history.length
    ? `Topics ALREADY used (do NOT resemble these):\n${history.map((h) => `- ${h}`).join('\n')}`
    : 'No topic history yet.';
  // Cross-pillar freshness: same audience sees every post — "git bisect" (Tips) right after
  // "git blame" (Drama) reads as a repeat even though the pillars differ.
  const recent = recentTopics.length
    ? `Topics this ACCOUNT published in the last days, ANY pillar (do NOT resemble these either — avoid the same tools/subject even with a different angle):\n${recentTopics.map((t) => `- ${t}`).join('\n')}`
    : '';
  const news = newsContext
    ? `Fresh news material (pick one as the basis, write the angle as "what it means for developers"):\n${newsContext}`
    : '';
  return [
    {
      role: 'system',
      content: `You are a content strategist for developers. Pick one specific topic and angle that has not been used yet. ${R}`,
    },
    {
      role: 'user',
      content: `Content pillar: ${p.name}
Pillar description: ${p.description}
${hist}
${recent}
${news}
Output JSON: {"topic": "<topic, 5-10 words>", "angle": "<1-2 sentences, why it's interesting>"}`,
    },
  ];
}

export function writerPrompt(
  platform: Platform,
  format: Format,
  topic: string,
  angle: string,
  pillarName: string,
  samples: StyleSample[],
  feedback?: string,
): Msg[] {
  const plat =
    platform === 'instagram'
      ? 'Instagram (developer audience, fast scrolling)'
      : 'LinkedIn (tech professional audience, calmer)';

  const fmt = {
    carousel: `Carousel ${platform === 'instagram' ? 'IG 5-8 slides' : 'LinkedIn 6-10 pages'}. Slide 1 = hook. Last slide = light CTA.
JSON: {"caption": {"title": "<max 10 words, punchy>", "subtitle": "<1-2 sentences, what this is about>", "cta": "<short action, e.g. save/share/follow — may be empty>", "tags": ["<3-5 hashtags WITH #, lowercase, no spaces>"]}, "slides": [{"headline": "<max 8 words>", "body": "<max 25 words"}]}
headline: scroll-stopper, short and punchy. body: one idea per slide, short sentences.`,
    reels: `Reels 15-30 seconds, 4-6 scenes, total narration MAX 55 words (speech pace ±2 words/second — more than that the duration explodes). Each narration MAX 12 words. Scene 1 = 5-second hook. Last scene = CTA.
JSON: {"caption": {"title": "<max 10 words, punchy>", "subtitle": "<1-2 sentences, what this is about>", "cta": "<short action, e.g. save/share/follow — may be empty>", "tags": ["<3-5 hashtags WITH #, lowercase, no spaces>"]}, "scenes": [{"overlay_text": "<max 10 words, large on-screen text>", "narration": "<1-2 spoken sentences, conversational>"}]}
narration: natural spoken language, not written prose. overlay_text: short phrase, not a full sentence.`,
    pdf: `LinkedIn carousel as PDF, 6-10 pages. Page 1 = hook. Last page = CTA/discussion prompt.
JSON: {"caption": string, "slides": [{"headline": "<max 8 words>", "body": "<max 25 words"}]}`,
    text: `LinkedIn text post. 150-250 words. First 2 lines must stop the thumb. Structure: hook → story/insight → reflection → closing question for discussion.
JSON: {"body": string}`,
  }[format]!;

  return [
    {
      role: 'system',
      content: `You are a ghostwriter producing developer content for ${plat}. Write a ${format} about the given topic. ${R}`,
    },
    {
      role: 'user',
      content: `Topic: ${topic}
Angle: ${angle}
Pillar: ${pillarName}
${feedback ? `\nPREVIOUS ATTEMPT REJECTED — do not repeat its mistakes:\n${feedback}\n` : ''}
Format:
${fmt}

${rules()}

Style samples (imitate the feel and rhythm, do NOT imitate the topics):
${styleBlock(samples)}`,
    },
  ];
}

export function criticPrompt(
  platform: Platform,
  format: Format,
  draft: unknown,
): Msg[] {
  const back = (f: Format): string => {
    if (f === 'reels') {
      const r = draft as ReelsOut;
      return JSON.stringify(r);
    }
    if (f === 'text') {
      return JSON.stringify(draft as { body: string });
    }
    const c = draft as CarouselOut;
    return JSON.stringify(c);
  };
  return [
    {
      role: 'system',
      content: `You are a ruthless editor. Revise the draft until it is publish-worthy. Fix: weak hooks, clichés, excessive emoji, fluff sentences, messy structure. Keep the topic and format structure. ${R}`,
    },
    {
      role: 'user',
      content: `Platform: ${platform}, format: ${format}. ${rules()}${
        format === 'reels' ? '\nREQUIRED: total narration MAX 55 words, per scene max 12 words (TTS duration 15-30 seconds).' : ''
      }

Draft:
${back(format)}

Return JSON with the EXACT same structure (keys and slide/scene counts may change if it improves the result), final revised version ready to publish.
Add TWO extra top-level fields: "score" (integer 0-10, honest — 7-8 = solid publish, below 7 = still weak) and "notes" (one short sentence, the weakest aspect of the ORIGINAL draft).`,
    },
  ];
}

// Cover image prompt (pure — unit-testable). Mechanical derivation from the slide headline:
// deterministic, no extra LLM call. ponytail: LLM-written image prompts if mechanical ones
// plateau (inject as an extra ideation field).
export function imagePrompt(headline: string): string {
  return [
    'Minimal flat vector illustration for a developer-audience social media cover.',
    `Subject: "${headline}".`,
    'Style: clean geometric shapes, dark background (#0f1117), one accent gradient (green to sky blue),',
    'subtle tech motifs (terminal windows, code brackets, git graphs), generous negative space.',
    'Absolutely no text, no letters, no words in the image. Composition centered, works cropped to 4:5.',
  ].join(' ');
}

// ——— AI planner (pure) ———
// Input shape for the planner LLM: upcoming runs + template palette + recent topics.
// The prompt enforces the EXCEPTION model: plan sparingly, justify every plan.
export type PlannerRun = {
  date: string; weekday: string;
  platform: 'instagram' | 'linkedin';
  format: 'carousel' | 'reels' | 'pdf' | 'text';
  pillar: { id: string; name: string; description: string };
};
export type PlannerTemplate = { id: string; name: string; type: string; format: string };

export function plannerPrompt(runs: PlannerRun[], templates: PlannerTemplate[], recentTopics: string[], starredTopics: string[] = []): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content: [
        'You are a content planner for a developer-audience social account (Indonesian content, casual-professional tone).',
        'You look at the UPCOMING week\'s scheduled runs and decide if any date should carry SPECIAL planned content',
        'instead of the regular pipeline output (e.g. a curated list post, a visual-only recap, a tools round-up).',
        '',
        'HARD RULES:',
        '- Plan SPARINGLY: 0-3 plans total. An empty list is a valid, often the best answer. NEVER plan every day.',
        '- for_date MUST be one of the given run dates. template_id MUST be one of the given template ids.',
        '- pillar_id (optional) MUST be one of the given pillar ids when present.',
        '- platform/format are optional overrides; when both given they must be compatible',
        '  (instagram: carousel|reels, linkedin: pdf|text). Omit them unless the plan changes them deliberately.',
        '- note (Indonesian, max 120 chars) explains the content idea and why that date/template fits.',
        '- Avoid repeating recent topics listed in the history.',
        '',
        'Return JSON: { "plans": [ { "for_date": "YYYY-MM-DD", "template_id": "...", "pillar_id": "..." (optional),',
        '"platform": "..." (optional), "format": "..." (optional), "note": "..." } ] }',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Scheduled runs for the next ${runs.length} slots:`,
        JSON.stringify(runs),
        '',
        'Template palette (any may be pinned; types other than "regular" are designed for special content):',
        JSON.stringify(templates),
        '',
        'Recent published topics (avoid repeating):',
        JSON.stringify(recentTopics.slice(0, 30)),
        ...(starredTopics.length
          ? ['', 'Starred topics — these RESONATED with the audience (human-judged). Lean toward similar angles/depth when proposing plans:', JSON.stringify(starredTopics)]
          : []),
        '',
        'Decide the plans for this week.',
      ].join('\n'),
    },
  ];
}

// ——— override description polish (pure) ———
// Manual override content: the human brings the MESSAGE, the AI brings the craft.
// Keeps facts and meaning intact — fixes wording, sharpens the hook, kills fluff.
// Style-anchored to the group's samples when available (consistent voice).
export function overridePolishPrompt(
  d: { name: string; type: string; description: string },
  samples: StyleSample[],
): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content: [
        'You are an editor polishing a MANUAL social media post (Indonesian, developer audience).',
        'The human wrote the message — you make it publish-worthy. Rules:',
        '- Keep the meaning, facts, names, numbers, and language (Indonesian stays Indonesian) INTACT.',
        '- First line must be a scroll-stopping hook (specific, concrete — no generic clickbait).',
        '- Fix awkward wording, kill filler words and clichés, tighten every sentence.',
        '- Match length to the platform role: this text lands as a caption/body next to images or standalone.',
        `- Type is "${d.type}" — image types read like captions; text_only reads like a LinkedIn post (hook → insight → closing line).`,
        '- Casual but sharp, like a developer sharing experience. Max 2 emoji.',
        'Reply ONLY with valid JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Post name: ${d.name}

Raw draft (fix this):
${d.description}

${samples.length > 0 ? `Style reference (imitate the feel and rhythm, not the topics):\n${styleBlock(samples)}` : 'No style samples — write naturally.'}

Return JSON: {"polished": "<the improved text>"}`,
    },
  ];
}

// ——— promotions (pure) ———
export type PromoData = {
  name: string; topic: string; features: string[]; stacks: string[]; stats: string[];
  price: string; price_sale: string;
};

export function promoBriefPrompt(brief: string): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: 'You draft product promotion data for a developer-audience content account (Indonesian, casual-professional). From a rough brief, produce structured promo data. Prices as display text (e.g. "Rp 299rb", "GRATIS"). Reply ONLY with valid JSON.' },
    { role: 'user', content: `Brief:\n${brief}\n\nReturn JSON: {"name": "<promo/product name>", "topic": "<one-line angle>", "features": ["<benefit, max 8 words>", ...3-6 items], "stacks": ["<tech>", ...2-5], "stats": ["<social proof, e.g. '10+ proyek selesai'>", ...0-3], "price": "<display text>", "price_sale": "<discounted display text, empty if none>"}` },
  ];
}

// Story arcs a promo deck may follow — one is drawn at random per run so two
// regens of the same promo never converge to the same structure. The formula
// deck (cover → pain → features → stack → price → proof → CTA) is deliberately
// NOT in the pool: the model falls back to it on its own when given nothing.
export const PROMO_ARCS: string[] = [
  'MINI-NARRATIVE: open mid-story — the reader at their worst concrete moment (deadline malam, demo gagal di depan klien, incident jam 2 pagi). 2-3 story slides, each escalating. The turning point slide introduces the product as the thing that changed the outcome. Result slide → offer → CTA.',
  'MYTH-BUSTING: open with a belief the audience holds that is actually wrong ("yang bilang X jelas belum pernah ..."). Bust it with a concrete mechanism or number. Show the better way — the product. Close with the offer as the practical fix.',
  'COUNTDOWN: "N kesalahan/kebiasaan/alat yang ..." — numbered slides, one item each, each item a real mistake the reader recognizes. The LAST item resolves into the product. Offer + CTA after.',
  'BEFORE/AFTER: contrast pairs. "Dulu" slide: the painful old way, concrete detail. "Sekarang" slide: the same task with the product. 2-3 pairs, then the offer. Use visual contrast in composition too (dark/dense before, open/light after).',
  'QUESTION HOOK: open with a sharp, specific question the reader asks themselves at work (not generic "pernah nggak sih?"). Answer it across slides with proof, then position the product as the answer made tool.',
  'BOLD CLAIM: open with a bold, specific, defensible claim (a number, a timeframe, an outcome). Spend the deck EARNING it: mechanism, proof, example. Offer arrives only after the claim feels earned.',
  'BEHIND-THE-SCENES: open with a process detail nobody shares (how the work actually gets done). Build credibility through craft slides — specifics, trade-offs, lessons. Reveal the offer late, as "kalau mau hasil yang sama tanpa trial-error-nya".',
];

export function promoContentPrompt(
  p: PromoData,
  cssVocab: string,
  arcOverride?: string,
): { role: 'system' | 'user'; content: string }[] {
  const arc = arcOverride ?? PROMO_ARCS[Math.floor(Math.random() * PROMO_ARCS.length)]!;
  return [
    {
      role: 'system',
      content: [
        'You are a slide art director for a product promotion (Indonesian, developer audience).',
        'You write ONE COMPLETE HTML fragment per slide — free layout, free composition.',
        '',
        'HARD RULES:',
        '- THE TEMPLATE OWNS THE CANVAS: its background, grid texture, fonts, base text color, logo and',
        '  footer ARE the deck\'s identity. Your fragment lives INSIDE it:',
        '  · NO background on your fragment\'s root container — no colors, no gradients, no opaque fills.',
        '    (A root background covers the template\'s backdrop, logo and footer — instantly rejected.)',
        '  · NO font-family anywhere — inherit the template\'s typography.',
        '- Compose with the template\'s CLASSES (listed in the user message) for recurring patterns;',
        '  inline styles only for size/spacing/alignment tweaks.',
        '- Accent colors ONLY from the template palette (listed in the user message). Never invent colors.',
        '- No <style> blocks, no <script>.',
        '- Text in Indonesian. Big fonts only (readable on a phone). No lorem ipsum.',
        '- 5-9 slides. ONE idea per slide — a slide that says two things says neither.',
        '',
        'CREATIVITY RULES (a boring deck is a rejected deck):',
        '- COMPOSITION MUST VARY slide to slide: never two consecutive slides with the same layout.',
        '  Mix full-bleed image slides, text+image splits, centered big statements, lists, stat highlights.',
        '- RHYTHM: alternate dense and sparse slides. A single bold sentence on an otherwise empty slide',
        '  is a valid and powerful slide. A deck of only dense list slides is rejected.',
        '- The promo DATA is a palette, not a checklist — use only the parts that serve the story.',
        '- Slide 1 is the scroll-stopper: max 8 words, big type. "Introducing X" and any generic',
        '  cover phrasing is banned — the hook must earn the swipe. No price on slide 1.',
        '- Price appears at most once, near the end, only as the deal (price_sale when present).',
        '- Where a slide needs a photo/illustration, place {{image}} inside an <img src="{{image}}">',
        '  or as a background, and describe the image in that slide\'s image_prompt (Indonesian, concrete: subject + style + mood).',
        '',
        'ANTI-SLOP RULES (these make a deck scream "AI-generated" — all banned):',
        '- Purple/violet gradient defaults, #7c5cff-style accents — use the TEMPLATE palette, not your habits.',
        '- An ALL-CAPS eyebrow label on every slide — at most one label in the whole deck.',
        '- Fake urgency ("slot terbatas", "harga naik besok") — only when the promo data actually says so.',
        '- Letter-spaced kickers, stacked badge pills, badge-over-badge.',
        'Voice: a developer sharing something they actually built — not a marketplace banner.',
        'Reply ONLY with valid JSON.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Promo data (a palette — use what the story needs, skip the rest):
${JSON.stringify(p, null, 1)}

Story arc for THIS deck (follow it; adapt only if the data truly contradicts it — do NOT fall back to the generic formula):
${arc}

Template CSS classes + palette you may use:
${cssVocab}

Return JSON: {"slides": [{"html": "<fragment>", "image_prompt": "<what image this slide needs, empty if none>"}, ... 5-9 slides]}`,
    },
  ];
}

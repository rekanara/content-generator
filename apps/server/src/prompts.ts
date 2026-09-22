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

export function ideationPrompt(p: PillarFull, history: string[], newsContext: string | null): Msg[] {
  const hist = history.length
    ? `Topics ALREADY used (do NOT resemble these):\n${history.map((h) => `- ${h}`).join('\n')}`
    : 'No topic history yet.';
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
${news}
Output JSON: {"topic": "<topic, 5-10 words>", "angle": "<1-2 sentences, why it's interesting"}`,
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

Return JSON with the EXACT same structure (keys and slide/scene counts may change if it improves the result), final revised version ready to publish.`,
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

export function plannerPrompt(runs: PlannerRun[], templates: PlannerTemplate[], recentTopics: string[]): { role: 'system' | 'user'; content: string }[] {
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
        '',
        'Decide the plans for this week.',
      ].join('\n'),
    },
  ];
}

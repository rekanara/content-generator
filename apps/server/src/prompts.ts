// Prompt builder — pure functions, unit-testable. Output language follows the pillar.
import type { Format, Platform } from './state.ts';
import type { Slide, Scene } from './schema.ts';

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
JSON: {"caption": string, "slides": [{"headline": "<max 8 words>", "body": "<max 25 words"}]}
headline: scroll-stopper, short and punchy. body: one idea per slide, short sentences.`,
    reels: `Reels 15-30 seconds, 4-6 scenes, total narration MAX 55 words (speech pace ±2 words/second — more than that the duration explodes). Each narration MAX 12 words. Scene 1 = 5-second hook. Last scene = CTA.
JSON: {"caption": string, "scenes": [{"overlay_text": "<max 10 words, large on-screen text>", "narration": "<1-2 spoken sentences, conversational>"}]}
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
      const r = draft as { caption: string; scenes: Scene[] };
      return JSON.stringify(r);
    }
    if (f === 'text') {
      return JSON.stringify(draft as { body: string });
    }
    const c = draft as { caption: string; slides: Slide[] };
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

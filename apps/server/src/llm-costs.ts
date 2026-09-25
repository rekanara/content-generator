// LLM cost catalog — static price map per model (USD per 1M tokens, prompt/completion),
// fallback tier for unknown models. Pure: no I/O, no env.
// Sources: OpenRouter public pricing pages (checked 2026-09). Prices are ESTIMATES for
// reporting — actual billing is whatever the gateway charges. Update entries as models
// change; the per-run cost is SNAPSHOTTED into usage rows so old rows never drift.
// ponytail: live price fetching from the gateway's /models endpoint when it exposes it.

export type ModelPrice = { prompt: number; completion: number }; // USD per 1M tokens
export type ImagePrice = { perImage: number }; // USD per image

const PRICES: Record<string, ModelPrice> = {
  // openai-compatible routes on the local gateway
  'dattio/glm-5.3-mod': { prompt: 0.6, completion: 2.2 },
  'dattio/glm-5.3': { prompt: 0.6, completion: 2.2 },
  'dattio/glm-5.2': { prompt: 0.6, completion: 2.2 },
  'glm-var/glm-5.2': { prompt: 0.6, completion: 2.2 },
  'dattio/gpt-5.6-terra': { prompt: 1.25, completion: 10 },
  'dattio/gpt-5.6-luna': { prompt: 1.25, completion: 10 },
  'dattio/deepseek-v4.1-mod': { prompt: 0.27, completion: 1.1 },
  'dattio/deepseek-v4-pro': { prompt: 0.27, completion: 1.1 },
  'dattio/kimi-k3-mod': { prompt: 0.6, completion: 2.5 },
  'dattio/kimi-k3': { prompt: 0.6, completion: 2.5 },
  'ag/claude-sonnet-4-6': { prompt: 3, completion: 15 },
  'ag/gemini-3-flash': { prompt: 0.3, completion: 2.5 },
  'ag/gemini-3-flash-agent': { prompt: 0.3, completion: 2.5 },
  'ag/gemini-3.5-flash-low': { prompt: 0.15, completion: 0.6 },
  'ag/gemini-3.5-flash-extra-low': { prompt: 0.1, completion: 0.4 },
  'ag/gemini-3.1-pro-low': { prompt: 1.25, completion: 5 },
  'ag/gemini-pro-agent': { prompt: 1.25, completion: 5 },
  'sumopod/claude-haiku-4-5': { prompt: 1, completion: 5 },
  'sumopod/deepseek-v4-pro': { prompt: 0.27, completion: 1.1 },
};

const IMAGE_PRICES: Record<string, ImagePrice> = {
  'openrouter/google/gemini-2.5-flash-image': { perImage: 0.039 },
  'openrouter/openai/gpt-image-1': { perImage: 0.11 }, // medium quality average
  'openrouter/recraft-v3': { perImage: 0.04 },
};

// unknown models: conservative mid-tier estimate, clearly marked in the UI via model name
const FALLBACK: ModelPrice = { prompt: 1, completion: 5 };

export function modelPrice(model: string): ModelPrice {
  return PRICES[model] ?? FALLBACK;
}

export function imagePrice(model: string): ImagePrice {
  return IMAGE_PRICES[model] ?? { perImage: 0.05 };
}

// Token usage → USD. Returns a number in full dollars (rounded at display time).
export function costOfTokens(model: string, prompt: number, completion: number): number {
  const p = modelPrice(model);
  return (prompt / 1e6) * p.prompt + (completion / 1e6) * p.completion;
}

// Serialized shape stored on rows: per-step tokens + the model + the snapshot cost.
export type StepUsage = { model: string; prompt: number; completion: number; cost: number };

export function stepUsage(model: string, prompt: number, completion: number): StepUsage {
  return { model, prompt, completion, cost: round4(costOfTokens(model, prompt, completion)) };
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

// Assemble the llm_usage jsonb for a post: steps + cover image cost + total.
export type PostUsage = {
  steps: Record<string, StepUsage>;
  cover?: { model: string; images: number; cost: number };
  totalCost: number;
};

export function postUsage(steps: Record<string, StepUsage>, cover?: PostUsage['cover']): PostUsage {
  const total = Object.values(steps).reduce((a, s) => a + s.cost, 0) + (cover?.cost ?? 0);
  return { steps, cover, totalCost: round4(total) };
}

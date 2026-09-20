// OpenAI-compatible chat completion client. JSON mode + 1 retry per call.
// Per-group config (GroupCfg) — baseUrl/apiKey/model from group ?? env.
import type { GroupCfg } from './groups.ts';

export type Usage = { prompt: number; completion: number };
export type LlmResult<T> = { data: T; usage: Usage };

type Msg = { role: 'system' | 'user'; content: string };

// ponytail: no streaming — output is short (JSON), streaming not needed.
// 9router sometimes appends an SSE tail ("data: [DONE]") after the JSON body —
// just parse the first object, discard the rest.
type RawResp = { content: string; usage: Usage };

function parseLoose(body: string): any {
  const start = body.indexOf('{');
  if (start < 0) throw new Error('LLM: body has no JSON');
  for (let end = body.lastIndexOf('}'); end > start; end = body.lastIndexOf('}', end - 1)) {
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch { /* try the previous closing bracket */ }
  }
  throw new Error(`LLM: no JSON found in body; head=${body.slice(0, 120)}`);
}

async function chatOnce(cfg: GroupCfg, model: string, messages: Msg[], maxTokens: number): Promise<RawResp> {
  const res = await fetch(`${cfg.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.llm.apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.8,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      stream: false, // provider ag/* defaults to SSE — force non-stream for a single JSON body
    }),
    signal: AbortSignal.timeout(300_000), // reasoning model via router: 120s not enough for critic
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  const json = parseLoose(text);
  const msg = json.choices?.[0]?.message;
  // Reasoning models (glm-5.3-mod) can burn all of max_tokens on reasoning_content
  // and leave content empty. Fallback: extract JSON from reasoning_content.
  let content = msg?.content;
  if (typeof content !== 'string' || content.length === 0) {
    const rc = msg?.reasoning_content;
    if (typeof rc === 'string') {
      const m = rc.match(/\{[\s\S]*\}/); // last JSON written in the reasoning
      if (m) {
        console.warn('[llm] content empty — falling back to JSON from reasoning_content');
        content = m[m.length - 1]!;
      }
    }
  }
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('LLM: content empty/malformed');
  }
  return {
    content,
    usage: {
      prompt: json?.usage?.prompt_tokens ?? 0,
      completion: json?.usage?.completion_tokens ?? 0,
    },
  };
}

// Chat + parse JSON + guard. Broken → 1x retry → throw.
export async function chatJson<T>(
  cfg: GroupCfg,
  model: string,
  messages: Msg[],
  guard: (x: unknown) => x is T,
  maxTokens = 4000, // reasoning models burn tokens on thinking; 2000 is not enough
): Promise<LlmResult<T>> {
  let lastErr = new Error('no attempt');
  for (let attempt = 0; attempt < 2; attempt++) {
    let content: string, usage: Usage;
    try {
      ({ content, usage } = await chatOnce(cfg, model, messages, maxTokens));
    } catch (e) {
      // router/upstream sometimes 503s on capacity — wait before retrying (typical retryDelay 52s)
      lastErr = e as Error;
      console.warn(`[llm] attempt ${attempt + 1} failed: ${lastErr.message.slice(0, 150)}`);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }
      throw lastErr;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // model output is sometimes wrapped in ```json ... ``` — strip it
      const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) {
        try {
          parsed = JSON.parse(m[1]!);
        } catch {
          lastErr = new Error(`JSON parse failed: ${(e as Error).message}; raw=${content.slice(0, 200)}`);
          continue;
        }
      } else {
        lastErr = new Error(`JSON parse failed: ${(e as Error).message}; raw=${content.slice(0, 200)}`);
        continue;
      }
    }
    if (guard(parsed)) return { data: parsed, usage };
    lastErr = new Error(`guard failed: structure mismatch; raw=${JSON.stringify(parsed).slice(0, 200)}`);
  }
  throw lastErr;
}

export type { Usage as LlmUsage };
export const criticModel = (cfg: GroupCfg): string => cfg.llm.criticModel;
export const writerModel = (cfg: GroupCfg): string => cfg.llm.model;

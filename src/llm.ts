// Klien openai-compatible chat completion. JSON mode + 1 retry per panggilan.
import { config } from './config.ts';

export type Usage = { prompt: number; completion: number };
export type LlmResult<T> = { data: T; usage: Usage };

type Msg = { role: 'system' | 'user'; content: string };

// ponytail: tidak ada streaming — output pendek (JSON), streaming tidak dibutuhkan.
// 9router kadang menempel SSE tail ("data: [DONE]") setelah body JSON — parse objek
// pertama saja via raw_decode, buang sisanya.
type RawResp = { content: string; usage: Usage };

function parseLoose(body: string): any {
  const start = body.indexOf('{');
  if (start < 0) throw new Error('LLM: body tanpa JSON');
  for (let end = body.lastIndexOf('}'); end > start; end = body.lastIndexOf('}', end - 1)) {
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch { /* coba bracket penutup sebelumnya */ }
  }
  throw new Error(`LLM: JSON tidak ketemu dalam body; head=${body.slice(0, 120)}`);
}

async function chatOnce(model: string, messages: Msg[], maxTokens: number): Promise<RawResp> {
  const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.llm.apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.8,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      stream: false, // provider ag/* default SSE — paksa non-stream agar body JSON tunggal
    }),
    signal: AbortSignal.timeout(300_000), // reasoning model via router: 120s kurang utk critic
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  const json = parseLoose(text);
  const msg = json.choices?.[0]?.message;
  // Model reasoning (glm-5.3-mod) bisa menghabiskan max_tokens untuk reasoning_content
  // dan meninggalkan content kosong. Fallback: ekstrak JSON dari reasoning_content.
  let content = msg?.content;
  if (typeof content !== 'string' || content.length === 0) {
    const rc = msg?.reasoning_content;
    if (typeof rc === 'string') {
      const m = rc.match(/\{[\s\S]*\}/); // JSON terakhir yang tertulis dalam reasoning
      if (m) {
        console.warn('[llm] content kosong — fallback JSON dari reasoning_content');
        content = m[m.length - 1]!;
      }
    }
  }
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('LLM: konten kosong/bentuk salah');
  }
  return {
    content,
    usage: {
      prompt: json?.usage?.prompt_tokens ?? 0,
      completion: json?.usage?.completion_tokens ?? 0,
    },
  };
}

// Chat + parse JSON + guard. Rusak → 1x retry → throw.
export async function chatJson<T>(
  model: string,
  messages: Msg[],
  guard: (x: unknown) => x is T,
  maxTokens = 4000, // reasoning model memakan token utk berpikir; 2000 kurang
): Promise<LlmResult<T>> {
  let lastErr = new Error('no attempt');
  for (let attempt = 0; attempt < 2; attempt++) {
    let content: string, usage: Usage;
    try {
      ({ content, usage } = await chatOnce(model, messages, maxTokens));
    } catch (e) {
      // router/upstream kadang 503 capacity — tunggu sebelum retry (retryDelay tipikal 52s)
      lastErr = e as Error;
      console.warn(`[llm] attempt ${attempt + 1} gagal: ${lastErr.message.slice(0, 150)}`);
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
      // konten model kadang dibungkus ```json ... ``` — strip
      const m = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (m) {
        try {
          parsed = JSON.parse(m[1]!);
        } catch {
          lastErr = new Error(`JSON parse gagal: ${(e as Error).message}; raw=${content.slice(0, 200)}`);
          continue;
        }
      } else {
        lastErr = new Error(`JSON parse gagal: ${(e as Error).message}; raw=${content.slice(0, 200)}`);
        continue;
      }
    }
    if (guard(parsed)) return { data: parsed, usage };
    lastErr = new Error(`guard gagal: struktur tidak sesuai; raw=${JSON.stringify(parsed).slice(0, 200)}`);
  }
  throw lastErr;
}

// Chat biasa (tanpa JSON) — untuk critic revisi yang outputnya JSON juga, jadi pakai chatJson.
export type { Usage as LlmUsage };
export const criticModel = (): string => config.llm.criticModel;
export const writerModel = (): string => config.llm.model;

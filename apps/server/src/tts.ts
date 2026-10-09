// TTS: msedge-tts default (free) or openai-compatible /v1/audio/speech.
// Single interface ttsToFile(cfg, text, path) — per-group config.
// Edge also returns per-word timings (WordBoundary) → reels captions sync to speech.
// ponytail: ElevenLabs goes here later too.
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import type { GroupCfg } from './groups.ts';

/** Spoken word timing, seconds from the start of this clip. */
export type WordTiming = { text: string; start: number; end: number };

// Edge metadata chunk(s) → word timings. Offsets/durations are 100ns ticks. Pure.
export function parseWordBoundaries(chunks: string[]): WordTiming[] {
  const out: WordTiming[] = [];
  for (const c of chunks) {
    let j: { Metadata?: { Type?: string; Data?: { Offset?: number; Duration?: number; text?: { Text?: string } } }[] };
    try { j = JSON.parse(c); } catch { continue; }
    for (const m of j.Metadata ?? []) {
      const d = m.Data;
      if (m.Type !== 'WordBoundary' || typeof d?.Offset !== 'number' || !d.text?.Text) continue;
      const start = d.Offset / 1e7;
      out.push({ text: d.text.Text, start, end: start + (d.Duration ?? 0) / 1e7 });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// Returns word timings when the provider gives them (edge), else [] (caller spreads evenly).
export async function ttsToFile(cfg: GroupCfg, text: string, path: string): Promise<WordTiming[]> {
  if (cfg.tts.provider === 'openai') { await openaiTts(cfg, text, path); return []; }
  return edgeTts(cfg, text, path);
}

async function edgeTts(cfg: GroupCfg, text: string, path: string): Promise<WordTiming[]> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(cfg.tts.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
    // v2 API: toStream(input) → Readable; toFile now expects a dir, not a file path.
    const { audioStream, metadataStream } = tts.toStream(text);
    const chunks: string[] = [];
    metadataStream?.on('data', (d: Buffer) => chunks.push(d.toString()));
    const metadataDone = metadataStream ? once(metadataStream, 'end') : Promise.resolve();
    await pipeline(audioStream, createWriteStream(path));
    await Promise.race([metadataDone, new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
    return parseWordBoundaries(chunks);
  } finally {
    tts.close();
  }
}

async function openaiTts(cfg: GroupCfg, text: string, path: string): Promise<void> {
  const res = await fetch(`${cfg.tts.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.tts.apiKey}` },
    body: JSON.stringify({ model: cfg.tts.model, voice: cfg.tts.voice, input: text }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`tts openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

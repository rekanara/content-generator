// TTS: msedge-tts default (free) or openai-compatible /v1/audio/speech.
// Single interface ttsToFile(cfg, text, path) — per-group config.
// ponytail: ElevenLabs goes here later too.
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import type { GroupCfg } from './groups.ts';

export async function ttsToFile(cfg: GroupCfg, text: string, path: string): Promise<void> {
  if (cfg.tts.provider === 'openai') return openaiTts(cfg, text, path);
  return edgeTts(cfg, text, path);
}

async function edgeTts(cfg: GroupCfg, text: string, path: string): Promise<void> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(cfg.tts.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    // v2 API: toStream(input) → Readable; toFile now expects a dir, not a file path.
    const { audioStream } = tts.toStream(text);
    await pipeline(audioStream, createWriteStream(path));
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

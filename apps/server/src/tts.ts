// TTS: msedge-tts default (gratis) atau openai-compatible /v1/audio/speech.
// Interface tunggal ttsToFile(cfg, text, path) — config per-group.
// ponytail: ElevenLabs nanti di sini juga.
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
    // v2 API: toStream(input) → Readable; toFile kini minta dir, bukan file path.
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

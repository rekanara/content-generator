// TTS: msedge-tts default (gratis) atau openai-compatible /v1/audio/speech.
// Interface tunggal ttsToFile(text, path) — ponytail: ElevenLabs nanti di sini juga.
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { config } from './config.ts';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export async function ttsToFile(text: string, path: string): Promise<void> {
  if (config.tts.provider === 'openai') return openaiTts(text, path);
  return edgeTts(text, path);
}

async function edgeTts(text: string, path: string): Promise<void> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(config.tts.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    // v2 API: toStream(input) → Readable; toFile kini minta dir, bukan file path.
    const { audioStream } = tts.toStream(text);
    await pipeline(audioStream, createWriteStream(path));
  } finally {
    tts.close();
  }
}

async function openaiTts(text: string, path: string): Promise<void> {
  const res = await fetch(`${config.tts.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.tts.apiKey}` },
    body: JSON.stringify({ model: config.tts.model, voice: config.tts.voice, input: text }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`tts openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

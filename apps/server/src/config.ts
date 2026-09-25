// Env loader + config types. The only file that reads process.env.
// Env values here are FALLBACKS — group-level overrides live in groups.ts (DB).
import { readFileSync } from 'node:fs';

for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      const key = m?.[1];
      if (m && key && !process.env[key]) process.env[key] = m[2] ?? '';
    }
  } catch { /* file missing — skip */ }
}

const req = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
};

export const config = {
  db: {
    host: req('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    user: req('DB_USER'),
    password: process.env.DB_PASSWORD ?? '',
    database: req('DB_NAME'),
  },
  minio: {
    endpoint: req('MINIO_ENDPOINT'),
    port: Number(process.env.MINIO_PORT ?? 9000),
    accessKey: req('MINIO_ACCESS_KEY'),
    secretKey: req('MINIO_SECRET_KEY'),
    bucket: process.env.MINIO_BUCKET ?? 'content-generator',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },
  llm: {
    // env = fallback; groups can override via DB. Presence validated at generate time.
    baseUrl: process.env.LLM_BASE_URL || '',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
    criticModel: process.env.LLM_MODEL_CRITIC || process.env.LLM_MODEL || '',
  },
  tts: {
    provider: (process.env.TTS_PROVIDER ?? 'edge') as 'edge' | 'openai',
    voice: process.env.TTS_VOICE ?? 'id-ID-ArdiNeural',
    baseUrl: process.env.TTS_BASE_URL || '',
    apiKey: process.env.TTS_API_KEY || '',
    model: process.env.TTS_MODEL || '',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  port: Number(process.env.PORT ?? 8787),
};

export type Config = typeof config;

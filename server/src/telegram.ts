// Telegram Bot API via fetch: sendMessage, sendMediaGroup, sendDocument.
// Artefak di-stream dari MinIO → buffer → Blob (file kecil, <1MB total).
import { config } from './config.ts';
import { getArtifactStream } from './storage.ts';

const BASE = () => `https://api.telegram.org/bot${config.telegram.botToken}`;

async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return mustOk(res, method);
}

async function postForm(method: string, fd: FormData): Promise<any> {
  const res = await fetch(`${BASE()}/${method}`, {
    method: 'POST',
    body: fd,
    signal: AbortSignal.timeout(120_000),
  });
  return mustOk(res, method);
}

async function mustOk(res: Response, method: string): Promise<any> {
  if (!res.ok) throw new Error(`telegram ${method} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  if (j.ok !== true) throw new Error(`telegram ${method} not ok: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

async function objectAsBlob(key: string): Promise<Blob> {
  const stream = await getArtifactStream(key);
  const chunks: Uint8Array[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return new Blob(chunks as BlobPart[], { type: 'image/png' });
}

export async function sendMessage(text: string): Promise<void> {
  await tg('sendMessage', { chat_id: config.telegram.chatId, text });
}

// Album photo max 10 (telegram limit). Caption menempel di foto pertama, max 1024 char.
export async function sendMediaGroupPhoto(keys: string[], caption: string): Promise<void> {
  const chatId = config.telegram.chatId;
  const use = keys.slice(0, 10);
  const media: { type: string; media: string; caption?: string }[] = use.map((_, i) => ({ type: 'photo', media: `attach://f${i}` }));
  media[0]!.caption = caption.slice(0, 1024);

  const fd = new FormData();
  fd.set('chat_id', chatId);
  fd.set('media', JSON.stringify(media));
  for (let i = 0; i < use.length; i++) {
    fd.set(`f${i}`, await objectAsBlob(use[i]!), `slide-${i + 1}.png`);
  }
  await postForm('sendMediaGroup', fd);
}

// sendDocument utk PDF (LinkedIn). Input file bisa >10MB — telegram batas 50MB, aman.
export async function sendDocument(key: string, filename: string, caption: string): Promise<void> {
  const fd = new FormData();
  fd.set('chat_id', config.telegram.chatId);
  fd.set('document', await objectAsBlob(key), filename);
  fd.set('caption', caption.slice(0, 1024));
  await postForm('sendDocument', fd);
}

// sendVideo utk reels MP4 — supports_streaming biar preview di Telegram.
export async function sendVideo(key: string, filename: string, caption: string): Promise<void> {
  const stream = await getArtifactStream(key);
  const chunks: Uint8Array[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const fd = new FormData();
  fd.set('chat_id', config.telegram.chatId);
  fd.set('video', new Blob(chunks as BlobPart[], { type: 'video/mp4' }), filename);
  fd.set('caption', caption.slice(0, 1024));
  fd.set('supports_streaming', 'true');
  await postForm('sendVideo', fd);
}

// Polling getUpdates — offset commit per update.
export type TgUpdate = { update_id: number; message?: { chat: { id: number }; text?: string } };

export async function getUpdates(offset: number, timeoutSec = 25): Promise<TgUpdate[]> {
  const res = await fetch(
    `${BASE()}/getUpdates?timeout=${timeoutSec}&offset=${offset}&allowed_updates=%5B%22message%22%5D`,
    { signal: AbortSignal.timeout((timeoutSec + 10) * 1000) },
  );
  const j = await mustOk(res, 'getUpdates');
  return j.result as TgUpdate[];
}

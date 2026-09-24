// Telegram Bot API via fetch: sendMessage, sendMediaGroup, sendDocument, sendVideo.
// Artifacts streamed from MinIO → buffer → Blob (small files, <1MB total).
// Per-group config (GroupCfg) — token/chatId from group ?? env.
import { getArtifactStream } from './storage.ts';
import type { GroupCfg } from './groups.ts';

const BASE = (cfg: GroupCfg) => `https://api.telegram.org/bot${cfg.telegram.botToken}`;

async function tg(cfg: GroupCfg, method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE(cfg)}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return mustOk(res, method);
}

// Long-poll for the global bot (env token) — used by bot.ts. Env token, not per-group.
// allowed_updates is EXPLICIT: Telegram persists this filter per-bot across calls —
// inheriting a stale ["message"] from any previous consumer silently drops all
// callback_query updates (approval buttons "did nothing" for exactly this reason).
export async function getUpdates(token: string, offset: number): Promise<any[]> {
  const allowed = encodeURIComponent('["message","callback_query"]');
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${allowed}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const j = await mustOk(res, 'getUpdates');
  return j.result ?? [];
}

async function postForm(cfg: GroupCfg, method: string, fd: FormData): Promise<any> {
  const res = await fetch(`${BASE(cfg)}/${method}`, {
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

async function objectAsBlob(key: string, type: string): Promise<Blob> {
  const stream = await getArtifactStream(key);
  const chunks: Uint8Array[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return new Blob(chunks as BlobPart[], { type });
}

export async function sendMessage(cfg: GroupCfg, text: string): Promise<void> {
  await tg(cfg, 'sendMessage', { chat_id: cfg.telegram.chatId, text });
}

// Text message with inline keyboard buttons (callback_data max 64 bytes — uuid + prefix fits).
// Used for the approval gate: [approve:<postId>] / [reject:<postId>].
export async function sendMessageWithButtons(
  cfg: GroupCfg,
  text: string,
  buttons: { text: string; callback_data: string }[][],
): Promise<void> {
  await tg(cfg, 'sendMessage', {
    chat_id: cfg.telegram.chatId,
    text,
    reply_markup: { inline_keyboard: buttons },
  });
}

// Download a file the bot received (manual cover photos). Global env token —
// the photo arrived on the polled bot, so getFile must use the same token.
// Telegram file downloads are capped at 20MB by the API — photos are well under.
export async function downloadTelegramFile(token: string, fileId: string): Promise<Buffer> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const j = await mustOk(res, 'getFile');
  const filePath: unknown = j?.result?.file_path;
  if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('telegram getFile: no file_path');
  const dl = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!dl.ok) throw new Error(`telegram file download ${dl.status}`);
  return Buffer.from(await dl.arrayBuffer());
}

// Answer a callback query (stops the button spinner in the client) — env token, bot polling side.
export async function answerCallback(token: string, callbackQueryId: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
    signal: AbortSignal.timeout(10_000),
  });
  await mustOk(res, 'answerCallbackQuery');
}

// Register the "/" command menu (the blue menu button in the chat UI). Idempotent —
// call at boot; Telegram stores it per-bot. Best-effort: failure never blocks polling.
export async function registerCommands(token: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'gen', description: 'Generate the next post (natural rotation)' },
        { command: 'ide', description: 'Save a topic to the idea backlog (used FIFO)' },
        { command: 'plan', description: 'AI-plan the upcoming week' },
        { command: 'override', description: 'Create override content for a date' },
        { command: 'rerender', description: 'Re-render latest post with current template' },
        { command: 'status', description: 'Schedule, rotation, latest post' },
        { command: 'cancel', description: 'Abort the current override session' },
        { command: 'help', description: 'All commands' },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  await mustOk(res, 'setMyCommands');
}

// Reply to a specific chat via env token (used by bot polling to reply to the chat the command came from).
export async function replyGlobal(chatId: string, text: string): Promise<void> {
  const token = (await import('./config.ts')).config.telegram.botToken;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(60_000),
  });
  await mustOk(res, 'sendMessage');
}

// Photo album max 10 (telegram limit). Caption attaches to the first photo, max 1024 chars.
export async function sendMediaGroupPhoto(cfg: GroupCfg, keys: string[], caption: string): Promise<void> {
  const chatId = cfg.telegram.chatId;
  const use = keys.slice(0, 10);
  const media: { type: string; media: string; caption?: string }[] = use.map((_, i) => ({ type: 'photo', media: `attach://f${i}` }));
  media[0]!.caption = caption.slice(0, 1024);

  const fd = new FormData();
  fd.set('chat_id', chatId);
  fd.set('media', JSON.stringify(media));
  for (let i = 0; i < use.length; i++) {
    fd.set(`f${i}`, await objectAsBlob(use[i]!, 'image/png'), `slide-${i + 1}.png`);
  }
  await postForm(cfg, 'sendMediaGroup', fd);
}

// Inline keyboard shape shared by all button-capable sends (approval gate, cover flow).
export type TgButtons = { text: string; callback_data: string }[][];

// Single photo with caption (override mix / image_only with one image — sendMediaGroup
// requires 2+ items). Content type detected from bytes so JPEG uploads render correctly.
// Optional buttons: Telegram media sends support reply_markup (media groups do NOT).
export async function sendPhoto(cfg: GroupCfg, key: string, caption: string, buttons?: TgButtons): Promise<void> {
  const stream = await getArtifactStream(key);
  const chunks: Uint8Array[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  const isJpeg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const fd = new FormData();
  fd.set('chat_id', cfg.telegram.chatId);
  fd.set('photo', new Blob([buf], { type: isJpeg ? 'image/jpeg' : 'image/png' }), isJpeg ? 'photo.jpg' : 'photo.png');
  fd.set('caption', caption.slice(0, 1024));
  if (buttons) fd.set('reply_markup', JSON.stringify({ inline_keyboard: buttons }));
  await postForm(cfg, 'sendPhoto', fd);
}

// sendDocument for PDF (LinkedIn). Input file can be >10MB — telegram limit is 50MB, safe.
export async function sendDocument(cfg: GroupCfg, key: string, filename: string, caption: string, buttons?: TgButtons): Promise<void> {
  const fd = new FormData();
  fd.set('chat_id', cfg.telegram.chatId);
  fd.set('document', await objectAsBlob(key, 'application/pdf'), filename);
  fd.set('caption', caption.slice(0, 1024));
  if (buttons) fd.set('reply_markup', JSON.stringify({ inline_keyboard: buttons }));
  await postForm(cfg, 'sendDocument', fd);
}

// sendVideo for reels MP4 — supports_streaming so Telegram shows a preview.
export async function sendVideo(cfg: GroupCfg, key: string, filename: string, caption: string, buttons?: TgButtons): Promise<void> {
  const stream = await getArtifactStream(key);
  const chunks: Uint8Array[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const fd = new FormData();
  fd.set('chat_id', cfg.telegram.chatId);
  fd.set('video', new Blob(chunks as BlobPart[], { type: 'video/mp4' }), filename);
  fd.set('caption', caption.slice(0, 1024));
  fd.set('supports_streaming', 'true');
  if (buttons) fd.set('reply_markup', JSON.stringify({ inline_keyboard: buttons }));
  await postForm(cfg, 'sendVideo', fd);
}

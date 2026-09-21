// Telegram bot: long-polling + command parsing. Regex-based, no framework.
// Polling uses the bot token env (global). Commands accept an optional group slug:
//   /gen <slug> <platform> <format> — without a slug = first group.
// Approval-gate callbacks arrive as callback_query updates (inline keyboard buttons):
//   approve:<postId> / reject:<postId>
import { getUpdates, replyGlobal, answerCallback, registerCommands, downloadTelegramFile } from './telegram.ts';
import { enqueue, queueStatus, bootCleanup } from './queue.ts';
import { sql } from './db/pool.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { uploadPostArtifact } from './storage.ts';
import { getRotation, getActivePillars } from './repos/rotation.ts';
import { nextSlot } from './state.ts';
import { getGroupCfg, listGroups } from './groups.ts';
import { rejectPost } from './repos/posts.ts';
import { addEvent } from './repos/events.ts';
import { createOverrideWithPlan, updateOverrideImages } from './repos/overrides.ts';
import { uploadOverrideBuffer } from './storage.ts';
import { jakartaToday } from './cronmath.ts';
import { config } from './config.ts';
import type { Platform, Format } from './state.ts';

// ——— command parser (pure, unit-test) ———
export type Cmd =
  | { t: 'gen'; slug?: string; platform?: Platform; format?: Format }
  | { t: 'rerender'; slug?: string }
  | { t: 'override'; slug?: string }
  | { t: 'cancel' }
  | { t: 'status'; slug?: string }
  | { t: 'help' }
  | { t: 'unknown'; raw: string };

const PLATFORMS: Platform[] = ['instagram', 'linkedin'];
const FORMATS: Format[] = ['carousel', 'reels', 'pdf', 'text'];

export function parseCmd(text: string, slugs: string[]): Cmd {
  const s = text.trim().toLowerCase();
  if (s === '/start' || s === '/help') return { t: 'help' };
  if (s === '/cancel') return { t: 'cancel' };
  if (s.startsWith('/status')) {
    const arg = s.split(/\s+/)[1];
    return { t: 'status', slug: arg && slugs.includes(arg) ? arg : undefined };
  }
  if (s.startsWith('/rerender')) {
    const arg = s.split(/\s+/)[1];
    return { t: 'rerender', slug: arg && slugs.includes(arg) ? arg : undefined };
  }
  if (s.startsWith('/override')) {
    const arg = s.split(/\s+/)[1];
    return { t: 'override', slug: arg && slugs.includes(arg) ? arg : undefined };
  }
  if (s.startsWith('/gen')) {
    const parts = s.split(/\s+/).slice(1);
    // is the first arg a known group slug? → belongs to group, rest is platform/format
    let slug: string | undefined;
    if (parts[0] && slugs.includes(parts[0])) {
      slug = parts.shift();
    }
    const platform = parts[0] as Platform | undefined;
    const format = parts[1] as Format | undefined;
    if (platform && !PLATFORMS.includes(platform)) return { t: 'unknown', raw: `unknown platform: ${platform}` };
    if (format && !FORMATS.includes(format)) return { t: 'unknown', raw: `unknown format: ${format}` };
    if (format && !platform) return { t: 'unknown', raw: 'format needs a platform: /gen [group] <platform> <format>' };
    return { t: 'gen', slug, platform, format };
  }
  return { t: 'unknown', raw: s };
}

// ——— approval callback parser (pure, unit-test) ———
export type Callback =
  | { t: 'approve'; postId: string }
  | { t: 'reject'; postId: string }
  | { t: 'skip_cover'; postId: string }
  | { t: 'ovtype'; value: 'mix' | 'image_only' | 'text_only' }
  | { t: 'ovdone' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCallback(data: string): Callback | null {
  const m = data.match(/^(approve|reject|skip_cover):([0-9a-f-]{36})$/i);
  if (m && UUID_RE.test(m[2]!)) {
    return { t: m[1]!.toLowerCase() as 'approve' | 'reject' | 'skip_cover', postId: m[2]!.toLowerCase() };
  }
  const ot = data.match(/^ovtype:(mix|image_only|text_only)$/);
  if (ot) return { t: 'ovtype', value: ot[1]! as 'mix' | 'image_only' | 'text_only' };
  if (data === 'ovdone') return { t: 'ovdone' };
  return null;
}

// ——— override date parser (pure, unit-test) ———
// Accepts YYYY-MM-DD and DD-MM-YYYY (Indonesian habit). Returns {date, past} or null.
export function parseOverrideDate(input: string, today: string): { date: string; past: boolean } | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); // YYYY-MM-DD
  let y: string, mo: string, d: string;
  if (m) {
    y = m[1]!; mo = m[2]!; d = m[3]!;
  } else {
    m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/); // DD-MM-YYYY
    if (!m) return null;
    d = m[1]!; mo = m[2]!; y = m[3]!;
  }
  const date = `${y}-${mo}-${d}`;
  const dt = new Date(`${date}T00:00:00Z`); // validate real calendar date
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.toISOString().slice(0, 10) !== date) return null; // e.g. 31-02 rolls over
  return { date, past: date < today };
}

// ——— handler ———

async function defaultSlug(): Promise<string> {
  const groups = await listGroups();
  return groups[0]?.slug ?? 'default';
}

async function handleStatus(slug?: string): Promise<string> {
  const s = slug ?? (await defaultSlug());
  const cfg = await getGroupCfg(s).catch(() => null);
  if (!cfg) return `group "${s}" not found`;
  const [state, pillars, q] = await Promise.all([getRotation(cfg.id), getActivePillars(cfg.id), Promise.resolve(queueStatus())]);
  const [grp] = await sql`select cron_expr, cron_enabled from groups where id = ${cfg.id}`;
  const [last] = await sql`select id, platform, format, topic, status, created_at
    from posts where group_id = ${cfg.id} order by id desc limit 1`;
  const next = nextSlot(state, pillars, true);
  const lines = [
    `Group: ${s}`,
    `Schedule: \`${grp?.cron_expr ?? '-'}\` ${grp?.cron_enabled ? 'ON' : 'OFF'}`,
    `Rotation: last=${state.last_platform ?? '-'} → next **${next.platform} ${next.format}** (pillar ${next.pillar_id})`,
    `Queue: ${q.running ? 'running' : 'idle'}${q.pending > 0 ? `, ${q.pending} pending` : ''}`,
  ];
  if (last) {
    lines.push(
      `Post #${last.id}: ${last.platform} ${last.format} — ${last.status} — "${String(last.topic).slice(0, 60)}"`,
    );
  }
  return lines.join('\n');
}

export async function handleCmd(cmd: Cmd): Promise<string> {
  switch (cmd.t) {
    case 'help': {
      const groups = await listGroups();
      const slugs = groups.map((x) => x.slug).join(', ');
      return [
        '/gen — generate the next post (first group, natural rotation)',
        '/gen <group> — force a group',
        '/gen <group> <platform> <format> — force group+platform+format',
        '/override [group] — create override content for a date (guided, step by step)',
        '/rerender [group] — re-render the latest post with the current template (content unchanged)',
        '/status [group] — schedule, rotation, latest post',
        '/cancel — abort the current /override session',
        `Available groups: ${slugs}`,
      ].join('\n');
    }
    case 'status':
      return handleStatus(cmd.slug);
    case 'cancel': {
      const had = overrideSessions.size > 0;
      overrideSessions.clear();
      return had ? 'Override session dibatalkan.' : 'Tidak ada sesi override yang aktif.';
    }
    case 'override': {
      const slug = cmd.slug ?? (await defaultSlug());
      const cfg = await getGroupCfg(slug).catch(() => null);
      if (!cfg) return `group "${slug}" not found`;
      overrideSessions.set(cfg.telegram.chatId, { slug, step: 'type', images: [], createdAt: Date.now() });
      const text = [
        `Override content untuk ${slug} — isi data satu per satu.`,
        'Pilih type dulu:',
        '· mix — 1 gambar + teks',
        '· image_only — beberapa gambar (+ caption)',
        '· text_only — teks saja, tanpa gambar',
        '',
        '(/cancel untuk batal)',
      ].join('\n');
      // buttons on the POLLED bot (env token) — callbacks come back to this loop
      await sendMessageWithButtonsRaw(cfg.telegram.chatId, text, [[
        { text: 'mix', callback_data: 'ovtype:mix' },
        { text: 'image_only', callback_data: 'ovtype:image_only' },
        { text: 'text_only', callback_data: 'ovtype:text_only' },
      ]]).catch(() => {});
      return '—'; // the button message above IS the reply; keep this out of the way
    }
    case 'rerender': {
      const slug = cmd.slug ?? (await defaultSlug());
      const cfg = await getGroupCfg(slug).catch(() => null);
      if (!cfg) return `group "${slug}" not found`;
      const [last] = await sql`select id, format, status from posts
        where group_id = ${cfg.id} order by created_at desc limit 1`;
      if (!last) return `no posts yet in "${slug}" — use /gen first`;
      if (last.format === 'text') return 'latest post is text format — nothing to re-render';
      if (!['sent', 'awaiting_approval', 'rendered'].includes(last.status)) {
        return `latest post status is ${last.status} — /rerender works on sent/awaiting/rendered. Use /gen instead.`;
      }
      enqueue({ kind: 'rerender', slug, postId: last.id });
      return `queued (${slug}) — post #${String(last.id).slice(0, 8)} will be re-rendered with the current template.`;
    }
    case 'gen': {
      const slug = cmd.slug ?? (await defaultSlug());
      const cfg = await getGroupCfg(slug).catch(() => null);
      if (!cfg) return `group "${slug}" not found`;
      enqueue({
        kind: 'generate',
        slug,
        forced: cmd.platform ? { platform: cmd.platform, format: cmd.format } : undefined,
        notifyChat: true,
        source: 'telegram',
      });
      return `queued (${slug}) — result will be sent when done.`;
    }
    default:
      return `Unknown command. ${cmd.raw}\nType /help`;
  }
}

// ——— polling loop ———
let stopped = false;

// ——— /override conversational session (per chat, in-memory) ———
type OvSession = {
  slug: string;
  step: 'type' | 'images' | 'description' | 'date';
  type?: 'mix' | 'image_only' | 'text_only';
  images: { file_id: string; width: number; height: number }[]; // Telegram file ids, downloaded at commit
  description?: string;
  createdAt: number;
};
const overrideSessions = new Map<string, OvSession>(); // chatId → session
const SESSION_TTL_MS = 30 * 60_000; // abandoned sessions expire silently

function getSession(chatId: string): OvSession | null {
  const s = overrideSessions.get(chatId);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    overrideSessions.delete(chatId);
    return null;
  }
  return s;
}

export function stopBot(): void {
  stopped = true;
}

export async function startBot(): Promise<void> {
  stopped = false;
  await bootCleanup();
  let offset = 0;
  if (!config.telegram.botToken) {
    console.log('[bot] TELEGRAM_BOT_TOKEN empty — skipping polling');
    return;
  }
  console.log('[bot] polling started');
  await registerCommands(config.telegram.botToken).catch((e) =>
    console.warn(`[bot] command menu registration failed: ${(e as Error).message}`));
  while (!stopped) {
    try {
      const updates = await getUpdates(config.telegram.botToken, offset);
      const slugs = (await listGroups()).map((x) => x.slug);
      for (const u of updates) {
        offset = u.update_id + 1;
        // per-update isolation: one bad update must never silently kill the rest of the batch
        try {
          // approval-gate / override-flow inline keyboard buttons
          if (u.callback_query) {
            const cb = u.callback_query;
            console.log(`[bot] callback "${cb.data}" from chat ${cb.message?.chat?.id}`);
            await answerCallback(config.telegram.botToken, String(cb.id)).catch(() => {});
            await handleCallback(String(cb.data ?? ''), String(cb.message?.chat?.id ?? config.telegram.chatId));
            continue;
          }

          const chatId = String(u.message?.chat?.id ?? config.telegram.chatId);
          const session = getSession(chatId);

          const text = u.message?.text;
          if (!text) {
            // photo upload: an active override session (image step) consumes it FIRST —
            // the user is explicitly mid-flow; only then does it fall through to the
            // awaiting_cover flow (both can be pending; session wins by recency).
            const photo = u.message?.photo;
            if (Array.isArray(photo) && photo.length > 0) {
              if (session && session.step === 'images') {
                await handleOverridePhoto(chatId, session, photo);
              } else {
                await handlePhoto(chatId, photo);
              }
            }
            continue;
          }

          // mid-session non-command text = step input (description / date)
          if (session && !text.trim().startsWith('/') && (session.step === 'description' || session.step === 'date')) {
            await handleOverrideText(chatId, session, text.trim());
            continue;
          }

          const cmd = parseCmd(text, slugs);
          const reply = await handleCmd(cmd);
          // reply via the global bot (env token) to the chat the command came from
          await replyGlobal(chatId, reply);
        } catch (e) {
          console.error(`[bot] update ${u.update_id} failed: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      console.error(`[bot] polling error: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000)); // 5s backoff
    }
  }
  console.log('[bot] polling stopped');
}

// Approve/reject/skip-cover/override-flow buttons. Group scoping comes from the post row
// (posts) or the session (override flow) itself.
async function handleCallback(data: string, chatId: string): Promise<void> {
  const cb = parseCallback(data);
  if (!cb) {
    await replyGlobal(chatId, `Unknown button: ${data}`);
    return;
  }

  // ——— override session flow buttons ———
  if (cb.t === 'ovtype') {
    const s = getSession(chatId);
    if (!s || s.step !== 'type') {
      await replyGlobal(chatId, 'Sesi override tidak aktif — mulai lagi dengan /override');
      return;
    }
    s.type = cb.value;
    if (cb.value === 'text_only') {
      s.step = 'description';
      await replyGlobal(chatId, 'Type: text_only — tanpa gambar.\nKirim teks konten (description):');
    } else {
      s.step = 'images';
      await replyGlobal(chatId, cb.value === 'mix'
        ? 'Type: mix — kirim 1 gambar cover:'
        : 'Type: image_only — kirim gambarnya satu per satu (maks 10), tekan Selesai setelah selesai:');
    }
    return;
  }
  if (cb.t === 'ovdone') {
    const s = getSession(chatId);
    if (!s || s.step !== 'images' || s.type !== 'image_only') {
      await replyGlobal(chatId, 'Tombol tidak berlaku untuk sesi ini');
      return;
    }
    if (s.images.length === 0) {
      await replyGlobal(chatId, 'Belum ada gambar — kirim minimal 1 gambar dulu.');
      return;
    }
    s.step = 'description';
    await replyGlobal(chatId, `${s.images.length} gambar tersimpan.\nKirim caption/description:`);
    return;
  }

  const [post] = await sql`select p.id, p.group_id, p.status, g.slug
    from posts p join groups g on g.id = p.group_id where p.id = ${cb.postId}`;
  if (!post) {
    await replyGlobal(chatId, `Post ${cb.postId} not found`);
    return;
  }
  if (cb.t === 'approve') {
    if (post.status !== 'awaiting_approval') {
      await replyGlobal(chatId, `Cannot approve #${post.id} — status is ${post.status}`);
      return;
    }
    enqueue({ kind: 'approve', slug: post.slug, postId: post.id });
    await replyGlobal(chatId, `Approved — #${post.id} delivering…`);
  } else if (cb.t === 'skip_cover') {
    if (post.status !== 'awaiting_cover') {
      await replyGlobal(chatId, `Cannot skip cover #${post.id} — status is ${post.status}`);
      return;
    }
    enqueue({ kind: 'coverContinue', slug: post.slug, postId: post.id, skipCover: true });
    await replyGlobal(chatId, `Cover dilewati — #${post.id} rendering tanpa cover…`);
  } else {
    const ok = await rejectPost(post.group_id, post.id);
    if (!ok) {
      await replyGlobal(chatId, `Cannot reject #${post.id} — status is ${post.status}`);
      return;
    }
    await addEvent(post.id, post.group_id, 'rejected').catch(() => {});
    await replyGlobal(chatId, `Rejected — #${post.id} · rotation not consumed`);
  }
}

// Manual cover: photo upload in the chat → download (largest size) → MinIO cover.png
// → resume the pipeline (render + gate/deliver). Status-driven: matches the latest
// awaiting_cover post. ponytail: photo replies scoped to a specific ask-message when
// multiple groups ever wait at once.
async function handlePhoto(chatId: string, photo: { file_id: string; width: number; height: number }[]): Promise<void> {
  const best = [...photo].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
  const [row] = await sql<{ id: string; group_id: string; slug: string; topic: string }[]>`
    select p.id, p.group_id, g.slug, p.topic from posts p join groups g on g.id = p.group_id
    where p.status = 'awaiting_cover' order by p.created_at desc limit 1`;
  if (!row) {
    await replyGlobal(chatId, 'Tidak ada post yang menunggu cover — foto diabaikan.');
    return;
  }
  const buf = await downloadTelegramFile(config.telegram.botToken, best.file_id);
  const dir = `out/${row.id}`;
  mkdirSync(dir, { recursive: true });
  const tmp = `${dir}/cover.png`;
  writeFileSync(tmp, buf);
  await uploadPostArtifact(row.slug, row.id, tmp, 'cover.png');
  await addEvent(row.id, row.group_id, 'cover_received').catch(() => {});
  console.log(`[bot] cover photo received → ${row.slug}/posts/${row.id}/cover.png (${buf.length}B)`);
  enqueue({ kind: 'coverContinue', slug: row.slug, postId: row.id });
  await replyGlobal(chatId, [
    `Cover diterima (${Math.round(buf.length / 1024)}KB) — "${String(row.topic).slice(0, 60)}"`,
    'Disimpan ke MinIO, rendering…',
  ].join('\n'));
}

// ——— /override session handlers ———

// Photo during the images step. mix: exactly 1 → auto-advance to description.
// image_only: accumulate (max 10) + "Selesai" button. Overshoot → replaced with guidance.
async function handleOverridePhoto(chatId: string, s: OvSession, photo: { file_id: string; width: number; height: number }[]): Promise<void> {
  const best = [...photo].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
  if (s.type === 'mix') {
    s.images = [best];
    s.step = 'description';
    await replyGlobal(chatId, 'Gambar diterima ✓\nKirim teks konten (description):');
    return;
  }
  if (s.images.length >= 10) {
    await replyGlobal(chatId, 'Maksimal 10 gambar (batas Telegram) — tekan Selesai.');
    return;
  }
  s.images.push(best);
  const n = s.images.length;
  await sendMessageWithButtonsRaw(chatId, `Gambar ${n} diterima ✓ — kirim lagi atau selesai:`, [
    [{ text: 'Selesai', callback_data: 'ovdone' }],
  ]);
}

// Non-command text during description/date steps.
async function handleOverrideText(chatId: string, s: OvSession, text: string): Promise<void> {
  if (s.step === 'description') {
    s.description = text;
    s.step = 'date';
    await replyGlobal(chatId, 'Description tersimpan ✓\nTerakhir, kirim tanggal tayang (YYYY-MM-DD atau DD-MM-YYYY):');
    return;
  }
  // date step → validate + commit
  const today = jakartaToday();
  const parsed = parseOverrideDate(text, today);
  if (!parsed) {
    await replyGlobal(chatId, 'Tanggal tidak valid — format YYYY-MM-DD atau DD-MM-YYYY (contoh: 25-12-2026).');
    return;
  }
  if (parsed.past) {
    await replyGlobal(chatId, `Tanggal ${parsed.date} sudah lewat (hari ini ${today}) — kirim tanggal hari ini atau besok.`);
    return;
  }
  await commitOverride(chatId, s, parsed.date);
}

// Create the DB row + download session photos to MinIO + confirm.
async function commitOverride(chatId: string, s: OvSession, forDate: string): Promise<void> {
  const cfg = await getGroupCfg(s.slug).catch(() => null);
  if (!cfg) {
    overrideSessions.delete(chatId);
    await replyGlobal(chatId, `group "${s.slug}" tidak ditemukan — sesi dibatalkan.`);
    return;
  }
  const name = (s.description ?? s.slug).slice(0, 60) || `override ${forDate}`;
  const type = s.type!;
  const imgCount = type === 'text_only' ? 0 : s.images.length;
  if (type === 'mix' && imgCount !== 1) {
    await replyGlobal(chatId, 'Type mix butuh tepat 1 gambar — mulai lagi dengan /override.');
    overrideSessions.delete(chatId);
    return;
  }
  if (type === 'image_only' && imgCount === 0) {
    await replyGlobal(chatId, 'Type image_only butuh minimal 1 gambar — mulai lagi dengan /override.');
    overrideSessions.delete(chatId);
    return;
  }
  try {
    // download all photos BEFORE creating the row — a mid-download failure must not
    // leave an orphan scheduled override owning the date
    const staged: { fname: string; buf: Buffer }[] = [];
    for (let i = 0; i < imgCount; i++) {
      const buf = await downloadTelegramFile(config.telegram.botToken, s.images[i]!.file_id);
      const ext = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? 'jpg' : 'png';
      staged.push({ fname: `img-${String(i + 1).padStart(2, '0')}.${ext}`, buf });
    }
    const ov = await createOverrideWithPlan(cfg.id, {
      name, type, template_id: null, description: s.description ?? '', for_date: forDate, images: [],
    });
    const names: string[] = [];
    for (const { fname, buf } of staged) {
      await uploadOverrideBuffer(ov.id, buf, fname);
      names.push(fname);
    }
    if (names.length > 0) await updateOverrideImages(ov.id, names);
    overrideSessions.delete(chatId);
    console.log(`[bot] override "${name}" created (${type}, ${names.length} img, ${forDate})`);
    await replyGlobal(chatId, [
      `Override tersimpan ✓`,
      `Nama: ${name}`,
      `Type: ${type}${names.length > 0 ? ` · ${names.length} gambar` : ''}`,
      `Tanggal: ${forDate}`,
      '',
      'Di tanggal itu generate otomatis di-cancel dan konten ini yang dikirim.',
      '(Kelola/ubah/hapus dari dashboard — tab Overrides)',
    ].join('\n'));
  } catch (e) {
    const msg = (e as Error).message;
    overrideSessions.delete(chatId);
    // unique (group, for_date) violation = date already owned by another override
    if (msg.includes('overrides_group_date') || msg.includes('plans_group_date')) {
      await replyGlobal(chatId, `Tanggal ${forDate} sudah dipakai override/plan lain (grup ini) — batalkan/hapus dulu dari dashboard, atau pilih tanggal lain.`);
    } else {
      await replyGlobal(chatId, `Gagal menyimpan override: ${msg.slice(0, 200)}`);
    }
  }
}

// sendMessage with buttons via the GLOBAL env token (session replies go to the polling chat).
// The per-group sendMessageWithButtons targets the group chat with the group's own bot —
// here we must answer on the bot the user is talking to.
async function sendMessageWithButtonsRaw(chatId: string, text: string, buttons: { text: string; callback_data: string }[][]): Promise<void> {
  const token = config.telegram.botToken;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: { inline_keyboard: buttons } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`telegram sendMessage ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

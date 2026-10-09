// Telegram bot: long-polling + command parsing. Regex-based, no framework.
// Polling uses the bot token env (global). Commands accept an optional group slug:
//   /gen <slug> <platform> <format> — without a slug = first group.
// Approval-gate callbacks arrive as callback_query updates (inline keyboard buttons):
//   approve:<postId> / reject:<postId>
import { getUpdates, replyGlobal, answerCallback, registerCommands, downloadTelegramFile, editMessageButtons } from './telegram.ts';
import { enqueue, queueStatus, bootCleanup } from './queue.ts';
import { sql } from './db/pool.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { uploadPostArtifact } from './storage.ts';
import { getRotation, getActivePillars } from './repos/rotation.ts';
import { nextSlot } from './state.ts';
import { getGroupCfg, listGroups } from './groups.ts';
import { rejectPost, toggleStar } from './repos/posts.ts';
import { addIdea, countUnusedIdeas } from './repos/ideas.ts';
import { addEvent } from './repos/events.ts';
import { createOverrideWithPlan, updateOverrideImages } from './repos/overrides.ts';
import { spentToday } from './repos/llm-runs.ts';
import { runPlanner, formatPlannerReport } from './usecases/planner.ts';
import { listNewsTopicsWithValidItems, listValidNewsItemsForTopic, getNewsItemGenerateContext } from './repos/news.ts';
import { fetchNewsUrl, ingestNewsTopic } from './usecases/news.ts';
import { uploadOverrideBuffer } from './storage.ts';
import { jakartaToday } from './cronmath.ts';
import { config } from './config.ts';
import type { Platform, Format } from './state.ts';

// ——— command parser (pure, unit-test) ———
export type Cmd =
  | { t: 'gen'; slug?: string; platform?: Platform; format?: Format }
  | { t: 'ide'; slug?: string; text: string }
  | { t: 'buat'; slug?: string }
  | { t: 'rerender'; slug?: string }
  | { t: 'override'; slug?: string }
  | { t: 'plan'; slug?: string }
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
  if (s.startsWith('/plan')) {
    const arg = s.split(/\s+/)[1];
    return { t: 'plan', slug: arg && slugs.includes(arg) ? arg : undefined };
  }
  if (s.startsWith('/override')) {
    const arg = s.split(/\s+/)[1];
    return { t: 'override', slug: arg && slugs.includes(arg) ? arg : undefined };
  }
  if (s.startsWith('/buat')) {
    const parts = s.split(/\s+/).slice(1);
    let slug: string | undefined;
    if (parts[0] && slugs.includes(parts[0])) slug = parts.shift()!.toLowerCase();
    return { t: 'buat', slug };
  }
  if (s.startsWith('/ide')) {
    // case matters for idea text — parse from the RAW text, not the lowercased copy
    const parts = text.trim().split(/\s+/).slice(1);
    let slug: string | undefined;
    if (parts[0] && slugs.includes(parts[0].toLowerCase())) slug = parts.shift()!.toLowerCase();
    const ideaText = parts.join(' ').trim();
    if (!ideaText) return { t: 'unknown', raw: 'usage: /ide [group] <idea text>' };
    return { t: 'ide', slug, text: ideaText.slice(0, 400) };
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
  | { t: 'regen'; postId: string }
  | { t: 'star'; postId: string }
  | { t: 'skip_cover'; postId: string }
  | { t: 'genpick'; slug: string; platform?: string; format?: string }
  | { t: 'newstopic'; topicId: string }
  | { t: 'newsfetchlatest'; topicId: string }
  | { t: 'newsfetchurl'; topicId: string }
  | { t: 'newsitem'; itemId: string }
  | { t: 'newsitemformat'; itemId: string; asReel: boolean }
  | { t: 'buatpick'; slug: string; platform?: string; format?: string }
  | { t: 'ovtype'; value: 'mix' | 'image_only' | 'text_only' }
  | { t: 'ovdone' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCallback(data: string): Callback | null {
  const m = data.match(/^(approve|reject|regen|star|skip_cover):([0-9a-f-]{36})$/i);
  if (m && UUID_RE.test(m[2]!)) {
    return { t: m[1]!.toLowerCase() as 'approve' | 'reject' | 'regen' | 'star' | 'skip_cover', postId: m[2]!.toLowerCase() };
  }
  // /gen format picker — genpick:<slug>:natural | genpick:<slug>:ig:carousel | ...
  const gm = data.match(/^genpick:([a-z0-9_-]+):(natural|news|ig:carousel|ig:reels|li:pdf|li:text)$/i);
  if (gm) {
    const slug = gm[1]!.toLowerCase();
    if (gm[2] === 'natural') return { t: 'genpick', slug, platform: undefined, format: undefined };
    if (gm[2] === 'news') return { t: 'genpick', slug, platform: 'news', format: undefined };
    const [p, f] = gm[2]!.split(':');
    return { t: 'genpick', slug, platform: p === 'ig' ? 'instagram' : 'linkedin', format: f as never };
  }
  const nt = data.match(/^nt:([0-9a-f-]{36})$/i);
  if (nt && UUID_RE.test(nt[1]!)) return { t: 'newstopic', topicId: nt[1]!.toLowerCase() };
  const nif = data.match(/^nif:([0-9a-f-]{36}):(c|r)$/i);
  if (nif && UUID_RE.test(nif[1]!)) return { t: 'newsitemformat', itemId: nif[1]!.toLowerCase(), asReel: nif[2]! === 'r' };
  const nfl = data.match(/^nfl:([0-9a-f-]{36})$/i);
  if (nfl && UUID_RE.test(nfl[1]!)) return { t: 'newsfetchlatest', topicId: nfl[1]!.toLowerCase() };
  const nfu = data.match(/^nfu:([0-9a-f-]{36})$/i);
  if (nfu && UUID_RE.test(nfu[1]!)) return { t: 'newsfetchurl', topicId: nfu[1]!.toLowerCase() };
  const ni = data.match(/^ni:([0-9a-f-]{36})$/i);
  if (ni && UUID_RE.test(ni[1]!)) return { t: 'newsitem', itemId: ni[1]!.toLowerCase() };
  // /buat format picker — same pattern as genpick but starts a content-capture session
  const bm = data.match(/^buatpick:([a-z0-9_-]+):(natural|ig:carousel|ig:reels|li:pdf|li:text)$/i);
  if (bm) {
    const slug = bm[1]!.toLowerCase();
    if (bm[2] === 'natural') return { t: 'buatpick', slug, platform: undefined, format: undefined };
    const [p, f] = bm[2]!.split(':');
    return { t: 'buatpick', slug, platform: p === 'ig' ? 'instagram' : 'linkedin', format: f as never };
  }
  const ot = data.match(/^ovtype:(mix|image_only|text_only)$/);
  if (ot) return { t: 'ovtype', value: ot[1]! as 'mix' | 'image_only' | 'text_only' };
  if (data === 'ovdone') return { t: 'ovdone' };
  if (/^noop:/i.test(data)) return null; // stamped button — ignore silently
  return null;
}

// Which message a callback is currently being processed against (set by the polling
// loop right before handleCallback) — lets handlers edit THAT message's buttons.
// Single-slot: callbacks are processed strictly sequentially in the polling loop.
let currentCallbackMessageId_: number | null = null;
export function currentCallbackMessageId(_chatId: string): number | null {
  return currentCallbackMessageId_;
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

// ——— chat → group routing (pure, unit-test) ———
// One bot, one chat per group. A command without a slug targets the group whose chat
// it was typed in. Chats not mapped to any group are ignored (anyone can DM a bot).
export function groupsForChat<G extends { slug: string; telegram_chat_id: string | null }>(
  groups: G[], chatId: string, fallbackChatId: string,
): G[] {
  return groups.filter((g) => (g.telegram_chat_id ?? fallbackChatId) === chatId);
}

const SLUG_CMDS = ['gen', 'ide', 'buat', 'rerender', 'override', 'plan', 'status'] as const;

export function withChatSlug(cmd: Cmd, chatSlug: string | undefined): Cmd {
  if (!chatSlug) return cmd;
  if (!(SLUG_CMDS as readonly string[]).includes(cmd.t)) return cmd;
  if ((cmd as { slug?: string }).slug) return cmd;
  return { ...cmd, slug: chatSlug } as Cmd;
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
  const [grp] = await sql`select cron_expr, cron_enabled, auto_plan from groups where id = ${cfg.id}`;
  const [last] = await sql`select id, platform, format, topic, status, starred, created_at
    from posts where group_id = ${cfg.id} order by id desc limit 1`;
  const [awaiting] = await sql`select count(*)::int as n from posts
    where group_id = ${cfg.id} and status = 'awaiting_approval'`;
  const [ideasN] = await sql`select count(*)::int as n from ideas
    where group_id = ${cfg.id} and used_at is null`;
  const spent = await spentToday(cfg.id);
  const next = pillars.length === 0 ? null : nextSlot(state, pillars, true);
  const lines = [
    `Group: ${s}`,
    `Schedule: \`${grp?.cron_expr ?? '-'}\` ${grp?.cron_enabled ? 'ON' : 'OFF'}`,
    next
      ? `Rotation: last=${state.last_platform ?? '-'} → next **${next.platform} ${next.format}** (pillar ${next.pillar_id})`
      : `Rotation: no active pillars — tambah pillar dulu`,
    `Queue: ${q.running ? 'running' : 'idle'}${q.pending > 0 ? `, ${q.pending} pending` : ''}`,
    `Awaiting approval: ${awaiting?.n ?? 0}${(awaiting?.n ?? 0) > 0 ? ' — buka FE atau tap tombolnya' : ''}`,
    `Ideas queued: ${ideasN?.n ?? 0}`,
    `Cost today: $${spent.toFixed(4)}${cfg.dailyBudget === null ? '' : ` / $${cfg.dailyBudget.toFixed(2)} budget`}`,
  ];
  if (last) {
    lines.push(
      `Post #${last.id}: ${last.platform} ${last.format} — ${last.status}${last.starred ? ' ★' : ''} — "${String(last.topic).slice(0, 60)}"`,
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
        '/gen — pilih format konten (termasuk News → topik → item valid)',
        '/gen <group> <platform> <format> — langsung pakai format spesifik (power-user)',
        '/buat [group] — kirim teks konten kamu sendiri, AI menstruktur jadi slide',
        '/ide [group] <ide> — simpan topik ke backlog (dipakai FIFO, skip ideation)',
        '/plan [group] — AI plans the upcoming week (creates cancelable plans)',
        '/override [group] — create override content for a date (guided, step by step)',
        '/rerender [group] — re-render the latest post with the current template (content unchanged)',
        '/status [group] — schedule, rotation, latest post',
        '/cancel — abort the current /override session',
        `Available groups: ${slugs}`,
      ].join('\n');
    }
    case 'status':
      return handleStatus(cmd.slug);
    case 'buat': {
      const slug = cmd.slug ?? (await defaultSlug());
      const cfg = await getGroupCfg(slug).catch(() => null);
      if (!cfg) return `group "${slug}" not found`;
      await sendMessageWithButtonsRaw(cfg.telegram.chatId, `Pilih format untuk konten kamu (${slug}):`, [
        [
          { text: '🌀 Natural rotation', callback_data: `buatpick:${slug}:natural` },
        ],
        [
          { text: '📱 IG Carousel', callback_data: `buatpick:${slug}:ig:carousel` },
          { text: '🎬 IG Reels', callback_data: `buatpick:${slug}:ig:reels` },
        ],
        [
          { text: '📄 LinkedIn PDF', callback_data: `buatpick:${slug}:li:pdf` },
          { text: '✍️ LinkedIn Text', callback_data: `buatpick:${slug}:li:text` },
        ],
      ]).catch(() => {});
      return '—';
    }
    case 'ide': {
      const slug = cmd.slug ?? (await defaultSlug());
      const cfg = await getGroupCfg(slug).catch(() => null);
      if (!cfg) return `group "${slug}" not found`;
      if (cmd.text.length < 3) return 'ideanya kependekan — min 3 karakter';
      const idea = await addIdea(cfg.id, cmd.text, 'bot');
      const n = await countUnusedIdeas(cfg.id);
      return `Idea disimpan (#${idea.id.slice(0, 8)}) — posisi ${n} di antrian ${slug}.\nPipeline akan memakainya di run berikutnya (FIFO), sebelum ideation LLM.`;
    }
    case 'cancel': {
      const hadOv = overrideSessions.size > 0;
      const hadBuat = buatSessions.size > 0 || newsUrlSessions.size > 0;
      overrideSessions.clear();
      buatSessions.clear();
      newsUrlSessions.clear();
      return hadOv || hadBuat ? 'Session dibatalkan.' : 'Tidak ada sesi yang aktif.';
    }
    case 'plan': {
      const slug = cmd.slug ?? (await defaultSlug());
      const cfg = await getGroupCfg(slug).catch(() => null);
      if (!cfg) return `group "${slug}" not found`;
      // fire-and-forget: the LLM call can take a minute — polling must not block.
      // Results (or the failure) arrive as a follow-up message in this chat.
      const chatId = cfg.telegram.chatId;
      console.log(`[bot] /plan ${slug} — planner started (manual)`);
      void runPlanner(cfg)
        .then((r) => {
          console.log(`[bot] /plan ${slug} done — ${r.created.length} plan(s) created`);
          return replyGlobal(chatId, formatPlannerReport(slug, r));
        })
        .catch((e) => replyGlobal(chatId, `Planner gagal: ${(e as Error).message.slice(0, 200)}`));
      return `Planner berjalan (${slug}) — hasilnya menyusul di chat ini.`;
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
      // forced args → direct enqueue (power-user path: /gen <group> <platform> <format>)
      if (cmd.platform) {
        enqueue({
          kind: 'generate', slug,
          forced: { platform: cmd.platform, format: cmd.format },
          notifyChat: true, source: 'telegram',
        });
        return `queued (${slug}) — ${cmd.platform}${cmd.format ? `/${cmd.format}` : ''}. Result will be sent when done.`;
      }
      // no args → show the format picker (self-documenting, one tap)
      await sendMessageWithButtonsRaw(cfg.telegram.chatId, `Pilih format untuk ${slug}:`, [
        [
          { text: '🌀 Natural rotation', callback_data: `genpick:${slug}:natural` },
        ],
        [
          { text: '📰 News', callback_data: `genpick:${slug}:news` },
        ],
        [
          { text: '📱 IG Carousel', callback_data: `genpick:${slug}:ig:carousel` },
          { text: '🎬 IG Reels', callback_data: `genpick:${slug}:ig:reels` },
        ],
        [
          { text: '📄 LinkedIn PDF', callback_data: `genpick:${slug}:li:pdf` },
          { text: '✍️ LinkedIn Text', callback_data: `genpick:${slug}:li:text` },
        ],
      ]).catch(() => {});
      return '—'; // the button message above IS the reply
    }
    default:
      return `Unknown command. ${cmd.raw}\nType /help`;
  }
}

// ——— /buat content-capture session (per chat, in-memory) ———
type BuatSession = { slug: string; platform?: Platform; format?: Format; createdAt: number };
const buatSessions = new Map<string, BuatSession>();
type NewsUrlSession = { slug: string; topicId: string; createdAt: number };
const newsUrlSessions = new Map<string, NewsUrlSession>();
const BUAT_TTL_MS = 5 * 60_000;
function getBuatSession(chatId: string): BuatSession | null {
  const s = buatSessions.get(chatId);
  if (!s) return null;
  if (Date.now() - s.createdAt > BUAT_TTL_MS) { buatSessions.delete(chatId); return null; }
  return s;
}

function getNewsUrlSession(chatId: string): NewsUrlSession | null {
  const s = newsUrlSessions.get(chatId);
  if (!s) return null;
  if (Date.now() - s.createdAt > BUAT_TTL_MS) { newsUrlSessions.delete(chatId); return null; }
  return s;
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
      const groups = await listGroups();
      const slugs = groups.map((x) => x.slug);
      for (const u of updates) {
        offset = u.update_id + 1;
        // per-update isolation: one bad update must never silently kill the rest of the batch
        try {
          const fromChat = String(u.callback_query?.message?.chat?.id ?? u.message?.chat?.id ?? '');
          const chatGroups = groupsForChat(groups, fromChat, config.telegram.chatId);
          if (chatGroups.length === 0) {
            console.warn(`[bot] ignored update from unmapped chat ${fromChat || '(none)'}`);
            if (u.callback_query) await answerCallback(config.telegram.botToken, String(u.callback_query.id)).catch(() => {});
            continue;
          }
          // one group in this chat → commands without a slug target it; several → first (as before)
          const chatSlug = chatGroups[0]!.slug;

          // approval-gate / override-flow inline keyboard buttons
          if (u.callback_query) {
            const cb = u.callback_query;
            console.log(`[bot] callback "${cb.data}" from chat ${cb.message?.chat?.id}`);
            await answerCallback(config.telegram.botToken, String(cb.id)).catch(() => {});
            currentCallbackMessageId_ = cb.message?.message_id ?? null;
            await handleCallback(String(cb.data ?? ''), String(cb.message?.chat?.id ?? config.telegram.chatId));
            currentCallbackMessageId_ = null;
            continue;
          }

          const chatId = String(u.message?.chat?.id ?? config.telegram.chatId);
          const newsUrlSession = getNewsUrlSession(chatId);
          const buatSession = getBuatSession(chatId);
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
            } else if (u.message?.video?.file_id) {
              await handleVideo(chatId, u.message.video);
            }
            continue;
          }

          if (newsUrlSession && !text.trim().startsWith('/')) {
            newsUrlSessions.delete(chatId);
            const url = text.trim();
            if (!/^https?:\/\//i.test(url)) { await replyGlobal(chatId, 'Kirim URL berita yang valid (http/https). Mulai lagi dari /gen → News → topic → Fetch one URL.'); continue; }
            await replyGlobal(chatId, `Reading article… ${url.slice(0, 120)}`);
            void fetchNewsUrl(await getGroupCfg(newsUrlSession.slug), newsUrlSession.topicId, url)
              .then(async (r) => {
                const lines = [
                  `Fetched one story (${newsUrlSession.slug})`,
                  `${r.item.status.toUpperCase()} · score ${r.item.score ?? '-'}`,
                  r.item.title,
                  `${r.item.domain} · ${r.matchedSource ? `RSS: ${r.matchedSource}` : 'not found in RSS sources'}`,
                  r.item.reason ?? '',
                ].filter(Boolean);
                await replyGlobal(chatId, lines.join('\n'));
                if (r.item.status === 'valid' && !r.item.post_id) {
                  await sendMessageWithButtonsRaw(chatId, 'Generate this story?', [[{ text: 'Generate', callback_data: `ni:${r.item.id}` }]]);
                }
              })
              .catch((e) => replyGlobal(chatId, `Fetch URL failed: ${(e as Error).message.slice(0, 250)}`));
            continue;
          }

          // mid-buat-session non-command text = the user's content brief
          if (buatSession && !text.trim().startsWith('/')) {
            buatSessions.delete(chatId);
            const brief = text.trim();
            if (brief.length < 10) {
              await replyGlobal(chatId, 'Teksnya kependekan — minimal 10 karakter. Mulai lagi dengan /buat');
              continue;
            }
            enqueue({
              kind: 'generate', slug: buatSession.slug,
              forced: buatSession.platform ? { platform: buatSession.platform, format: buatSession.format } : undefined,
              notifyChat: true, source: 'telegram', brief,
            });
            await replyGlobal(chatId, `Oke — konten kamu (${brief.length} karakter) di-queue sebagai ${buatSession.slug}${buatSession.platform ? ` ${buatSession.platform}${buatSession.format ? `/${buatSession.format}` : ''}` : ''}. AI akan menstruktur jadi slide, hasilnya menyusul.`);
            continue;
          }

          // mid-session non-command text = step input (description / date)
          if (session && !text.trim().startsWith('/') && (session.step === 'description' || session.step === 'date')) {
            await handleOverrideText(chatId, session, text.trim());
            continue;
          }

          const cmd = withChatSlug(parseCmd(text, slugs), chatSlug);
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

  // ——— /gen format picker (inline button → enqueue with forced platform/format) ———
  if (cb.t === 'genpick') {
    const cfg = await getGroupCfg(cb.slug).catch(() => null);
    if (!cfg) { await replyGlobal(chatId, `group "${cb.slug}" not found`); return; }
    if (cb.platform === 'news') {
      const topics = await listNewsTopicsWithValidItems(cfg.id);
      if (topics.length === 0) { await replyGlobal(chatId, `Belum ada news topic aktif untuk ${cb.slug}. Buat topic dulu di dashboard (News).`); return; }
      await sendMessageWithButtonsRaw(chatId, `Pilih topik news (${cb.slug}):`, topics.map((t) => ([{ text: `${t.name} (${t.n})`.slice(0, 60), callback_data: `nt:${t.id}` }])));
      return;
    }
    const label = cb.platform ? `${cb.platform} ${cb.format}` : 'natural rotation';
    enqueue({
      kind: 'generate', slug: cb.slug,
      forced: cb.platform ? { platform: cb.platform as Platform, format: cb.format as Format } : undefined,
      notifyChat: true, source: 'telegram',
    });
    const msgId = currentCallbackMessageId(chatId);
    if (msgId) await editMessageButtons(chatId, msgId, [[{ text: `▶ ${label}`, callback_data: `noop:${cb.slug}` }]])
      .catch((e) => console.warn(`[bot] genpick stamp failed: ${(e as Error).message}`));
    await replyGlobal(chatId, `Queued (${cb.slug}) — ${label}. Hasilnya menyusul.`);
    return;
  }

  if (cb.t === 'newstopic') {
    const items = await listValidNewsItemsForTopic(cb.topicId);
    await sendMessageWithButtonsRaw(chatId, items.length ? 'Pilih news yang mau digenerate, atau fetch baru:' : 'Belum ada valid news di topik ini. Fetch dulu:', [
      [
        { text: '🔄 Fetch latest', callback_data: `nfl:${cb.topicId}` },
        { text: '🔗 Fetch one URL', callback_data: `nfu:${cb.topicId}` },
      ],
      ...items.map((i) => ([{
        text: `${i.title.slice(0, 48)}${i.score === null ? '' : ` · ${i.score}`}`,
        callback_data: `ni:${i.id}`,
      }])),
    ]);
    return;
  }

  if (cb.t === 'newsfetchlatest' || cb.t === 'newsfetchurl') {
    const [t] = await sql<{ slug: string; name: string }[]>`select g.slug, t.name from news_topics t join groups g on g.id = t.group_id where t.id = ${cb.topicId}`;
    if (!t) { await replyGlobal(chatId, 'News topic tidak ditemukan.'); return; }
    const msgId = currentCallbackMessageId(chatId);
    if (cb.t === 'newsfetchurl') {
      newsUrlSessions.set(chatId, { slug: t.slug, topicId: cb.topicId, createdAt: Date.now() });
      if (msgId) await editMessageButtons(chatId, msgId, [[{ text: `🔗 ${t.name} — kirim URL`, callback_data: `noop:${cb.topicId}` }]]).catch(() => {});
      await replyGlobal(chatId, `Kirim URL berita untuk topik "${t.name}". (5 menit, /cancel untuk batal)`);
      return;
    }
    if (msgId) await editMessageButtons(chatId, msgId, [[{ text: `🔄 Fetching ${t.name}…`, callback_data: `noop:${cb.topicId}` }]]).catch(() => {});
    await replyGlobal(chatId, `Fetching latest news for "${t.name}" — bisa beberapa menit.`);
    const cfg = await getGroupCfg(t.slug);
    void ingestNewsTopic(cfg.id, cb.topicId, cfg)
      .then(async (r) => {
        await replyGlobal(chatId, `Fetch done — ${r.fetched} fetched, ${r.valid} valid, ${r.rejected} rejected, ${r.skipped} already known${r.feedsFailed ? `, ${r.feedsFailed} feed(s) failed` : ''}.`);
        const items = await listValidNewsItemsForTopic(cb.topicId);
        if (items.length) await sendMessageWithButtonsRaw(chatId, 'Pilih news yang mau digenerate:', items.map((i) => ([{
          text: `${i.title.slice(0, 48)}${i.score === null ? '' : ` · ${i.score}`}`,
          callback_data: `ni:${i.id}`,
        }])));
      })
      .catch((e) => replyGlobal(chatId, `Fetch failed: ${(e as Error).message.slice(0, 250)}`));
    return;
  }

  if (cb.t === 'newsitemformat') {
    const ctx = await getNewsItemGenerateContext(cb.itemId);
    if (!ctx) { await replyGlobal(chatId, 'News ini sudah tidak valid / sudah pernah digenerate.'); return; }
    enqueue({
      kind: 'generate',
      slug: ctx.slug,
      forced: { platform: 'instagram', format: cb.asReel ? 'reels' : 'carousel' },
      notifyChat: true,
      source: 'telegram',
      newsTopicId: ctx.topicId,
      newsItemId: cb.itemId,
      newsLanguage: 'id',
      templateId: (cb.asReel ? ctx.templateReelId : ctx.templateId) ?? undefined,
    });
    const msgId = currentCallbackMessageId(chatId);
    if (msgId) await editMessageButtons(chatId, msgId, [[{ text: `▶ ${cb.asReel ? 'reel' : 'carousel'} ${ctx.title.slice(0, 38)}`, callback_data: `noop:${cb.itemId}` }]]).catch(() => {});
    await replyGlobal(chatId, `Queued news (${ctx.slug}) — ${ctx.title.slice(0, 80)}. Hasilnya menyusul.`);
    return;
  }

  if (cb.t === 'newsitem') {
    const ctx = await getNewsItemGenerateContext(cb.itemId);
    if (!ctx) { await replyGlobal(chatId, 'News ini sudah tidak valid / sudah pernah digenerate.'); return; }
    if (ctx.templateReelId) {
      await sendMessageWithButtonsRaw(chatId, `Format untuk "${ctx.title.slice(0, 60)}"?`, [
        [{ text: 'Carousel (default)', callback_data: `nif:${cb.itemId}:c` }],
        [{ text: 'Reels', callback_data: `nif:${cb.itemId}:r` }],
      ]);
      return;
    }
    enqueue({
      kind: 'generate',
      slug: ctx.slug,
      forced: { platform: 'instagram', format: 'carousel' },
      notifyChat: true,
      source: 'telegram',
      newsTopicId: ctx.topicId,
      newsItemId: cb.itemId,
      newsLanguage: 'id',
      templateId: ctx.templateId ?? undefined,
    });
    const msgId = currentCallbackMessageId(chatId);
    if (msgId) await editMessageButtons(chatId, msgId, [[{ text: `▶ carousel ${ctx.title.slice(0, 38)}`, callback_data: `noop:${cb.itemId}` }]]).catch(() => {});
    await replyGlobal(chatId, `Queued news (${ctx.slug}) — ${ctx.title.slice(0, 80)}. Hasilnya menyusul.`);
    return;
  }

  // ——— /buat format picker (inline button → start content-capture session) ———
  if (cb.t === 'buatpick') {
    const cfg = await getGroupCfg(cb.slug).catch(() => null);
    if (!cfg) { await replyGlobal(chatId, `group "${cb.slug}" not found`); return; }
    buatSessions.set(cfg.telegram.chatId, {
      slug: cb.slug,
      platform: cb.platform as Platform | undefined,
      format: cb.format as Format | undefined,
      createdAt: Date.now(),
    });
    const label = cb.platform ? `${cb.platform} ${cb.format}` : 'natural rotation';
    const msgId = currentCallbackMessageId(chatId);
    if (msgId) await editMessageButtons(chatId, msgId, [[{ text: `✍️ ${label} — kirim teks`, callback_data: `noop:${cb.slug}` }]])
      .catch(() => {});
    await replyGlobal(chatId, `Format: ${label}. Kirim teks konten kamu sekarang — tulis detail sebanyak mau, AI akan menstruktur jadi slide. Hashtag yang kamu kasih ikut dipakai. (5 menit sebelum session hangus, /cancel untuk batal)`);
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

  const [post] = await sql`select p.id, p.group_id, p.status, p.starred, g.slug
    from posts p join groups g on g.id = p.group_id where p.id = ${cb.postId}`;
  if (!post) {
    await replyGlobal(chatId, `Post ${cb.postId} not found`);
    return;
  }

  // Terminal-stamp the origin message of this button press (no zombie buttons).
  // Best-effort: an edit failure never blocks the action itself.
  const stamp = async (label: string, extra?: { text: string; callback_data: string }[][]) => {
    const msgId = currentCallbackMessageId(chatId);
    if (!msgId) return;
    await editMessageButtons(chatId, msgId, extra ?? [[{ text: `✓ ${label}`, callback_data: `noop:${cb.postId}` }]])
      .catch((e) => console.warn(`[bot] stamp failed: ${(e as Error).message}`));
  };

  if (cb.t === 'approve') {
    if (post.status !== 'awaiting_approval') {
      await replyGlobal(chatId, `Cannot approve #${post.id} — status is ${post.status}`);
      return;
    }
    enqueue({ kind: 'approve', slug: post.slug, postId: post.id });
    await stamp('Approved — delivering…', [[
      { text: '✓ Approved — delivering…', callback_data: `noop:${post.id}` },
      { text: '☆ Star', callback_data: `star:${post.id}` },
    ]]);
  } else if (cb.t === 'regen') {
    if (post.status !== 'awaiting_approval') {
      await replyGlobal(chatId, `Cannot regenerate #${post.id} — status is ${post.status}`);
      return;
    }
    // same contract as reject: instant, rotation-safe. Then a fresh generate run.
    const ok = await rejectPost(post.group_id, post.id);
    if (!ok) {
      await replyGlobal(chatId, `Cannot regenerate #${post.id} — status changed to ${post.status}`);
      return;
    }
    await addEvent(post.id, post.group_id, 'rejected', 'regenerate via telegram').catch(() => {});
    await stamp('Regenerating…');
    enqueue({ kind: 'generate', slug: post.slug, notifyChat: true, source: 'telegram' });
    await replyGlobal(chatId, `Rejected + regenerating (${post.slug}) — hasilnya menyusul.`);
  } else if (cb.t === 'star') {
    // allowed on any delivered-ish state — starring is metadata, not a status op
    if (!['sent', 'awaiting_approval'].includes(post.status)) {
      await replyGlobal(chatId, `Star hanya untuk post terkirim (status: ${post.status})`);
      return;
    }
    const starred = await toggleStar(post.group_id, post.id);
    if (starred === null) {
      await replyGlobal(chatId, `Post ${post.id} not found`);
      return;
    }
    await stamp(starred ? '★ Starred — planner signal' : '☆ Unstarred', [[
      { text: starred ? '★ Starred' : '☆ Star', callback_data: `star:${post.id}` },
    ]]);
    console.log(`[bot] star toggled #${post.id} → ${starred}`);
  } else if (cb.t === 'skip_cover') {
    if (post.status !== 'awaiting_cover') {
      await replyGlobal(chatId, `Cannot skip cover #${post.id} — status is ${post.status}`);
      return;
    }
    enqueue({ kind: 'coverContinue', slug: post.slug, postId: post.id, skipCover: true });
    await stamp('Cover skipped — rendering…');
  } else {
    const ok = await rejectPost(post.group_id, post.id);
    if (!ok) {
      await replyGlobal(chatId, `Cannot reject #${post.id} — status is ${post.status}`);
      return;
    }
    await addEvent(post.id, post.group_id, 'rejected').catch(() => {});
    await stamp('Rejected — rotation not consumed');
  }
}

// Manual cover: photo upload in the chat → download (largest size) → MinIO cover.png
// → resume the pipeline (render + gate/deliver). Status-driven: matches the latest
// awaiting_cover post. ponytail: photo replies scoped to a specific ask-message when
// multiple groups ever wait at once.
async function awaitingCoverRow(chatId: string): Promise<{ id: string; group_id: string; slug: string; topic: string; format: string } | null> {
  const [row] = await sql<{ id: string; group_id: string; slug: string; topic: string; format: string }[]>`
    select p.id, p.group_id, g.slug, p.topic, p.format from posts p join groups g on g.id = p.group_id
    where p.status = 'awaiting_cover' and coalesce(nullif(g.telegram_chat_id, ''), ${config.telegram.chatId}) = ${chatId}
    order by p.created_at desc limit 1`;
  return row ?? null;
}

async function handlePhoto(chatId: string, photo: { file_id: string; width: number; height: number }[]): Promise<void> {
  const best = [...photo].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
  const row = await awaitingCoverRow(chatId);
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

async function handleVideo(chatId: string, video: { file_id: string; file_size?: number; duration?: number }): Promise<void> {
  const row = await awaitingCoverRow(chatId);
  if (!row || row.format !== 'reels') {
    await replyGlobal(chatId, 'Tidak ada reels yang menunggu background video — video diabaikan.');
    return;
  }
  if ((video.file_size ?? 0) > 45 * 1024 * 1024) {
    await replyGlobal(chatId, 'Video terlalu besar. Kirim video ≤45MB atau tekan Lewati.');
    return;
  }
  const buf = await downloadTelegramFile(config.telegram.botToken, video.file_id);
  const dir = `out/${row.id}`;
  mkdirSync(dir, { recursive: true });
  const tmp = `${dir}/cover.mp4`;
  writeFileSync(tmp, buf);
  await uploadPostArtifact(row.slug, row.id, tmp, 'cover.mp4');
  await addEvent(row.id, row.group_id, 'cover_received').catch(() => {});
  console.log(`[bot] cover video received → ${row.slug}/posts/${row.id}/cover.mp4 (${buf.length}B)`);
  enqueue({ kind: 'coverContinue', slug: row.slug, postId: row.id });
  await replyGlobal(chatId, [
    `Background video diterima (${Math.round(buf.length / 1024 / 1024)}MB) — "${String(row.topic).slice(0, 60)}"`,
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

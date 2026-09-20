// Bot Telegram: long-polling + command parse. Regex-based, no framework.
// Polling pakai bot token env (global). Command menerima slug group opsional:
//   /gen <slug> <platform> <format> — tanpa slug = group pertama.
import { getUpdates, replyGlobal } from './telegram.ts';
import { enqueue, queueStatus, bootCleanup } from './queue.ts';
import { getRotation, getActivePillars, sql } from './db.ts';
import { nextSlot } from './state.ts';
import { getGroupCfg, listGroups } from './groups.ts';
import { config } from './config.ts';
import type { Platform, Format } from './state.ts';

// ——— command parser (pure, unit-test) ———
export type Cmd =
  | { t: 'gen'; slug?: string; platform?: Platform; format?: Format }
  | { t: 'status'; slug?: string }
  | { t: 'help' }
  | { t: 'unknown'; raw: string };

const PLATFORMS: Platform[] = ['instagram', 'linkedin'];
const FORMATS: Format[] = ['carousel', 'reels', 'pdf', 'text'];

export function parseCmd(text: string, slugs: string[]): Cmd {
  const s = text.trim().toLowerCase();
  if (s === '/start' || s === '/help') return { t: 'help' };
  if (s.startsWith('/status')) {
    const arg = s.split(/\s+/)[1];
    return { t: 'status', slug: arg && slugs.includes(arg) ? arg : undefined };
  }
  if (s.startsWith('/gen')) {
    const parts = s.split(/\s+/).slice(1);
    // arg pertama slug group dikenal? → milik group, sisanya platform/format
    let slug: string | undefined;
    if (parts[0] && slugs.includes(parts[0])) {
      slug = parts.shift();
    }
    const platform = parts[0] as Platform | undefined;
    const format = parts[1] as Format | undefined;
    if (platform && !PLATFORMS.includes(platform)) return { t: 'unknown', raw: `platform tak dikenal: ${platform}` };
    if (format && !FORMATS.includes(format)) return { t: 'unknown', raw: `format tak dikenal: ${format}` };
    if (format && !platform) return { t: 'unknown', raw: 'format butuh platform: /gen [group] <platform> <format>' };
    return { t: 'gen', slug, platform, format };
  }
  return { t: 'unknown', raw: s };
}

// ——— handler ———

async function defaultSlug(): Promise<string> {
  const groups = await listGroups();
  return groups[0]?.slug ?? 'default';
}

async function handleStatus(slug?: string): Promise<string> {
  const s = slug ?? (await defaultSlug());
  const cfg = await getGroupCfg(s).catch(() => null);
  if (!cfg) return `group "${s}" tidak ada`;
  const [state, pillars, q] = await Promise.all([getRotation(cfg.id), getActivePillars(cfg.id), Promise.resolve(queueStatus())]);
  const [grp] = await sql`select cron_expr, cron_enabled from groups where id = ${cfg.id}`;
  const [last] = await sql`select id, platform, format, topic, status, created_at
    from posts where group_id = ${cfg.id} order by id desc limit 1`;
  const next = nextSlot(state, pillars, true);
  const lines = [
    `Group: ${s}`,
    `Jadwal: \`${grp?.cron_expr ?? '-'}\` ${grp?.cron_enabled ? 'AKTIF' : 'MATI'}`,
    `Rotasi: last=${state.last_platform ?? '-'} → next **${next.platform} ${next.format}** (pilar ${next.pillar_id})`,
    `Queue: ${q.running ? 'run jalan' : 'idle'}${q.pending > 0 ? `, ${q.pending} menunggu` : ''}`,
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
        '/gen — generate berikutnya (group pertama, rotasi natural)',
        '/gen <group> — paksa group',
        '/gen <group> <platform> <format> — paksa group+platform+format',
        '/status [group] — jadwal, rotasi, post terakhir',
        `Group tersedia: ${slugs}`,
      ].join('\n');
    }
    case 'status':
      return handleStatus(cmd.slug);
    case 'gen': {
      const slug = cmd.slug ?? (await defaultSlug());
      const cfg = await getGroupCfg(slug).catch(() => null);
      if (!cfg) return `group "${slug}" tidak ada`;
      enqueue({
        kind: 'generate',
        slug,
        forced: cmd.platform ? { platform: cmd.platform, format: cmd.format } : undefined,
        notifyChat: true,
        source: 'telegram',
      });
      return `queued (${slug}) — hasil dikirim saat selesai.`;
    }
    default:
      return `Perintah tak dikenal. ${cmd.raw}\nKetik /help`;
  }
}

// ——— polling loop ———
let stopped = false;

export function stopBot(): void {
  stopped = true;
}

export async function startBot(): Promise<void> {
  stopped = false;
  await bootCleanup();
  let offset = 0;
  if (!config.telegram.botToken) {
    console.log('[bot] TELEGRAM_BOT_TOKEN kosong — polling dilewati');
    return;
  }
  console.log('[bot] polling mulai');
  while (!stopped) {
    try {
      const updates = await getUpdates(config.telegram.botToken, offset);
      const slugs = (await listGroups()).map((x) => x.slug);
      for (const u of updates) {
        offset = u.update_id + 1;
        const text = u.message?.text;
        if (!text) continue;
        const cmd = parseCmd(text, slugs);
        const reply = await handleCmd(cmd);
        // balasan via bot global (env token) ke chat asal command
        await replyGlobal(String(u.message?.chat?.id ?? config.telegram.chatId), reply);
      }
    } catch (e) {
      console.error(`[bot] polling error: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000)); // backoff 5s
    }
  }
  console.log('[bot] polling berhenti');
}

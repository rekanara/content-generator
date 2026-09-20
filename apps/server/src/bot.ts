// Telegram bot: long-polling + command parsing. Regex-based, no framework.
// Polling uses the bot token env (global). Commands accept an optional group slug:
//   /gen <slug> <platform> <format> — without a slug = first group.
import { getUpdates, replyGlobal } from './telegram.ts';
import { enqueue, queueStatus, bootCleanup } from './queue.ts';
import { sql } from './db/pool.ts';
import { getRotation, getActivePillars } from './repos/rotation.ts';
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
        '/status [group] — schedule, rotation, latest post',
        `Available groups: ${slugs}`,
      ].join('\n');
    }
    case 'status':
      return handleStatus(cmd.slug);
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
        // reply via the global bot (env token) to the chat the command came from
        await replyGlobal(String(u.message?.chat?.id ?? config.telegram.chatId), reply);
      }
    } catch (e) {
      console.error(`[bot] polling error: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000)); // 5s backoff
    }
  }
  console.log('[bot] polling stopped');
}

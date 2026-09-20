// Bot Telegram: long-polling + command parse. Regex-based, no framework.
import { getUpdates } from './telegram.ts';
import { enqueue, queueStatus, bootCleanup } from './queue.ts';
import { sql, getRotation, getActivePillars } from './db.ts';
import { nextSlot } from './state.ts';
import { sendMessage } from './telegram.ts';
import type { Platform, Format } from './state.ts';

// ——— command parser (pure, unit-test) ———
export type Cmd =
  | { t: 'gen'; platform?: Platform; format?: Format }
  | { t: 'status' }
  | { t: 'help' }
  | { t: 'unknown'; raw: string };

const PLATFORMS: Platform[] = ['instagram', 'linkedin'];
const FORMATS: Format[] = ['carousel', 'reels', 'pdf', 'text'];

export function parseCmd(text: string): Cmd {
  const s = text.trim().toLowerCase();
  if (s === '/start' || s === '/help') return { t: 'help' };
  if (s === '/status') return { t: 'status' };
  if (s.startsWith('/gen')) {
    const parts = s.split(/\s+/);
    const platform = parts[1] as Platform | undefined;
    const format = parts[2] as Format | undefined;
    if (platform && !PLATFORMS.includes(platform)) return { t: 'unknown', raw: `platform tak dikenal: ${platform}` };
    if (format && !FORMATS.includes(format)) return { t: 'unknown', raw: `format tak dikenal: ${format}` };
    if (format && !platform) return { t: 'unknown', raw: 'format butuh platform: /gen <platform> <format>' };
    return { t: 'gen', platform, format };
  }
  return { t: 'unknown', raw: s };
}

// ——— handler ———

async function handleStatus(): Promise<string> {
  const [state, pillars, q] = await Promise.all([getRotation(), getActivePillars(), Promise.resolve(queueStatus())]);
  const [cronRow] = await sql`select cron_expr, cron_enabled from settings limit 1`;
  const [last] = await sql`select id, platform, format, topic, status, created_at
    from posts order by id desc limit 1`;
  const next = nextSlot(state, pillars, true);
  const lines = [
    `Jadwal: \`${cronRow?.cron_expr ?? '-'}\` ${cronRow?.cron_enabled ? 'AKTIF' : 'MATI'}`,
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
    case 'help':
      return [
        '/gen — generate berikutnya (rotasi natural)',
        '/gen instagram|linkedin — paksa platform',
        '/gen instagram|linkedin carousel|reels|pdf|text — paksa keduanya',
        '/status — jadwal, rotasi, post terakhir',
      ].join('\n');
    case 'status':
      return handleStatus();
    case 'gen':
      enqueue({ kind: 'generate', forced: cmd.platform ? { platform: cmd.platform, format: cmd.format } : undefined, notifyChat: true, source: 'telegram' });
      return 'queued — hasil dikirim saat selesai.';
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
  console.log('[bot] polling mulai');
  while (!stopped) {
    try {
      const updates = await getUpdates(offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        const text = u.message?.text;
        if (!text) continue;
        const cmd = parseCmd(text);
        const reply = await handleCmd(cmd);
        await sendMessage(reply);
      }
    } catch (e) {
      console.error(`[bot] polling error: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 5000)); // backoff 5s
    }
  }
  console.log('[bot] polling berhenti');
}

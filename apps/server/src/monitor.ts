// Watchdog: silent-failure alerting for the content pipeline.
// (a) Boot check — a cron slot that fired while the daemon was down is detected at startup.
// (b) Heartbeat — every 6h, re-checks all cron-enabled groups (missed slot stays missed until run).
// A slot is "missed" when its scheduled fire time has passed AND no post was created since
// (cron or manual — any sent/generated post counts; failed runs are a separate signal).
// ponytail: an awaiting_approval post also counts as slot coverage — an "awaiting too long"
// alert would cover generated-but-never-approved posts, add when approval gates are common.
// Alert goes to the group's own Telegram chat (per-group cfg, env fallback). Never throws.
import { CronJob } from 'cron';
import { sql } from './db/pool.ts';
import { prevFire } from './cronmath.ts';
import { sendMessage } from './telegram.ts';
import { getGroupCfgById } from './groups.ts';

const GRACE_MS = 10 * 60_000; // slot fired < 10min ago → assume run in flight, don't alert
// in-memory alert dedup per slot (groupId → alerted fire time ms).
// ponytail: DB-backed dedup if daemon restarts make duplicate alerts annoying.
const alerted = new Map<string, number>();

async function checkGroup(g: { id: string; slug: string; cron_expr: string; cron_enabled: boolean }): Promise<void> {
  if (!g.cron_enabled) return;
  const prev = prevFire(g.cron_expr, new Date());
  if (!prev) return;
  if (Date.now() - prev.getTime() < GRACE_MS) return;
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from posts
    where group_id = ${g.id} and created_at >= ${prev}`;
  if ((row?.n ?? 0) > 0) return; // run happened (any status) — slot covered
  if (alerted.get(g.id) === prev.getTime()) return; // already alerted for this slot
  alerted.set(g.id, prev.getTime());

  const cfg = await getGroupCfgById(g.id).catch(() => null);
  if (!cfg?.telegram.botToken || !cfg.telegram.chatId) {
    console.warn(`[monitor] ${g.slug}: slot missed ${prev.toISOString()} — no telegram cfg, alert skipped`);
    return;
  }
  await sendMessage(cfg, [
    `Scheduled run missed — ${cfg.slug}`,
    `Slot: ${prev.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB (${g.cron_expr})`,
    'No post was created for this slot.',
    `Run manually: /gen ${cfg.slug}`,
  ].join('\n'));
  console.warn(`[monitor] ${g.slug}: missed slot ${prev.toISOString()} — alerted`);
}

export async function checkAll(): Promise<void> {
  const groups = await sql<{ id: string; slug: string; cron_expr: string; cron_enabled: boolean }[]>`select id, slug, cron_expr, cron_enabled from groups`;
  await Promise.allSettled(groups.map(checkGroup));
}

/** Boot check + heartbeat cron (every 6h). Call once at daemon start. */
export function startMonitor(): void {
  void checkAll().catch((e) => console.error(`[monitor] boot check failed: ${(e as Error).message}`));
  new CronJob(
    '0 */6 * * *',
    () => void checkAll().catch((e) => console.error(`[monitor] heartbeat failed: ${(e as Error).message}`)),
    null,
    true,
    'Asia/Jakarta',
  );
  console.log('[monitor] watchdog started (boot check + heartbeat every 6h)');
}

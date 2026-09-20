// Cron in-app: jadwal dari settings DB, re-schedule saat berubah, tanpa restart daemon.
import { CronJob } from 'cron';
import { sql } from './db.ts';
import { enqueue, queueStatus } from './queue.ts';

let job: CronJob | null = null;
let currentExpr = '';
let currentEnabled = false;

type Settings = { cron_expr: string; cron_enabled: boolean };

async function readSettings(): Promise<Settings> {
  const [row] = await sql`select cron_expr, cron_enabled from settings limit 1`;
  if (!row || !row.cron_expr) throw new Error('settings.cron_expr kosong — jalankan migrate');
  return { cron_expr: row.cron_expr, cron_enabled: !!row.cron_enabled };
}

function apply(expr: string, enabled: boolean): void {
  if (job) {
    job.stop();
    job = null;
  }
  currentExpr = expr;
  currentEnabled = enabled;
  if (!enabled) {
    console.log(`[cron] MATI (expr: ${expr})`);
    return;
  }
  job = new CronJob(
    expr,
    () => {
      console.log(`[cron] trigger ${expr} — enqueue generate`);
      enqueue({ kind: 'generate', notifyChat: true, source: 'cron' });
    },
    null, // onComplete
    true, // start
    'Asia/Jakarta',
  );
  console.log(`[cron] AKTIF: ${expr} (Asia/Jakarta)`);
}

/** Muat setting awal + start. Dipanggil sekali saat daemon boot. */
export async function startCron(): Promise<void> {
  const s = await readSettings();
  apply(s.cron_expr, s.cron_enabled);
}

/**
 * Re-read settings DB; re-schedule kalau berubah. Bisa dipanggil kapan saja
 * (FE step 7 manggil ini setelah update setting). No-op kalau tidak berubah.
 */
export async function refreshCron(): Promise<void> {
  const s = await readSettings();
  if (s.cron_expr === currentExpr && s.cron_enabled === currentEnabled) return;
  apply(s.cron_expr, s.cron_enabled);
}

export function cronStatus(): { expr: string; enabled: boolean; running: boolean } {
  return { expr: currentExpr, enabled: currentEnabled, running: !!job };
}

// cegar hit ganda: kalau run masih jalan saat trigger berikutnya, queue FIFO tetap satu sumber kebenaran
export function cronAndQueueStatus(): string {
  const q = queueStatus();
  return `cron=${cronStatus().expr} ${cronStatus().enabled ? 'AKTIF' : 'MATI'} | queue: ${q.running ? 'run jalan' : 'idle'}${q.pending > 0 ? `, ${q.pending} menunggu` : ''}`;
}

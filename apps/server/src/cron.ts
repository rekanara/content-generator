// In-app cron per group: schedule from the groups DB row, re-scheduled on change.
// Map of groupId → CronJob. Boot: load all groups. Cron patch → refreshCron(group).
import { CronJob } from 'cron';
import { sql } from './db/pool.ts';
import { enqueue } from './queue.ts';

type JobState = { job: CronJob | null; expr: string; enabled: boolean };
const jobs = new Map<string, JobState>();

function apply(groupId: string, slug: string, expr: string, enabled: boolean): void {
  const st = jobs.get(groupId);
  if (st) st.job?.stop();
  jobs.set(groupId, { job: null, expr, enabled });
  if (!enabled) {
    console.log(`[cron] ${slug}: OFF (expr: ${expr})`);
    return;
  }
  const job = new CronJob(
    expr,
    () => {
      console.log(`[cron] ${slug} trigger ${expr} — enqueue generate`);
      enqueue({ kind: 'generate', slug, notifyChat: true, source: 'cron' });
    },
    null, // onComplete
    true, // start
    'Asia/Jakarta',
  );
  jobs.get(groupId)!.job = job;
  console.log(`[cron] ${slug}: ON ${expr} (Asia/Jakarta)`);
}

/** Load all groups + start each one. Called once at daemon boot. */
export async function startCron(): Promise<void> {
  const rows = await sql`select id, slug, cron_expr, cron_enabled from groups`;
  for (const g of rows) apply(g.id, g.slug, g.cron_expr, g.cron_enabled);
}

/** Re-read group; re-schedule if changed. No-op if unchanged. */
export async function refreshCron(groupId: string): Promise<void> {
  const [g] = await sql`select id, slug, cron_expr, cron_enabled from groups where id = ${groupId}`;
  if (!g) {
    // group deleted → stop the job
    jobs.get(groupId)?.job?.stop();
    jobs.delete(groupId);
    return;
  }
  const st = jobs.get(groupId);
  if (st && st.expr === g.cron_expr && st.enabled === g.cron_enabled) return;
  apply(g.id, g.slug, g.cron_expr, g.cron_enabled);
}

/** Cron status per group. */
export function cronStatus(groupId: string): { expr: string; enabled: boolean; running: boolean } {
  const st = jobs.get(groupId);
  return { expr: st?.expr ?? '', enabled: st?.enabled ?? false, running: !!st?.job };
}

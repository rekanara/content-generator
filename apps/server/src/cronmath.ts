// Cron fire-time math on top of the `cron` package's CronTime — no jobs, no side effects.
// Used by the watchdog (prevFire) and the calendar preview (nextFires).
// TZ must match cron.ts (both hardcode Asia/Jakarta — ponytail: single config when multi-region).
import { CronTime } from 'cron';

export const TZ = 'Asia/Jakarta';

// Next n fire times strictly after `from`. Invalid expr → [].
export function nextFires(expr: string, from: Date, n: number): Date[] {
  if (n <= 0) return [];
  let ct: CronTime;
  try {
    ct = new CronTime(expr);
  } catch {
    return [];
  }
  const out: Date[] = [];
  let t = ct.getNextDateFrom(from, TZ);
  for (let i = 0; i < n; i++) {
    out.push(t.toJSDate());
    t = ct.getNextDateFrom(t.toJSDate(), TZ);
  }
  return out;
}

// Last fire time <= now, searched within `lookbackDays` (default 35 covers daily/weekly/monthly).
// getNextDateFrom is strictly-after its start, so the walk can't loop.
// null = no fire in the window, or expr invalid/unsatisfiable (never alert on garbage).
// Iteration cap 5000 guards pathological exprs (e.g. every-minute + 35-day lookback).
export function prevFire(expr: string, now: Date, lookbackDays = 35): Date | null {
  let ct: CronTime;
  try {
    ct = new CronTime(expr);
  } catch {
    return null;
  }
  const windowStart = new Date(now.getTime() - lookbackDays * 86400_000);
  let t = ct.getNextDateFrom(windowStart, TZ).toJSDate();
  let prev: Date | null = null;
  for (let i = 0; i < 5000 && t.getTime() <= now.getTime(); i++) {
    prev = t;
    t = ct.getNextDateFrom(t, TZ).toJSDate();
  }
  return prev;
}

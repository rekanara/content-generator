// In-memory login rate limit (per IP): 5 failures / 15 min → 15 min lockout.
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
type Bucket = { fails: number; windowStart: number; lockedUntil: number };
const buckets = new Map<string, Bucket>();

export function loginBlocked(ip: string): number {
  const b = buckets.get(ip);
  if (!b) return 0;
  if (b.lockedUntil > Date.now()) return Math.ceil((b.lockedUntil - Date.now()) / 1000);
  if (Date.now() - b.windowStart > WINDOW_MS && b.lockedUntil < Date.now()) buckets.delete(ip);
  return 0;
}

export function loginFail(ip: string): void {
  const now = Date.now();
  const b = buckets.get(ip) ?? { fails: 0, windowStart: now, lockedUntil: 0 };
  if (now - b.windowStart > WINDOW_MS) { b.fails = 0; b.windowStart = now; }
  b.fails++;
  if (b.fails >= MAX_FAILS) b.lockedUntil = now + WINDOW_MS;
  buckets.set(ip, b);
}

export function loginClear(ip: string): void {
  buckets.delete(ip);
}

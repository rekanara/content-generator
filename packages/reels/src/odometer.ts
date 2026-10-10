export type OdoChar = { ch: string; digit: number | null };
export type OdoParts = { chars: OdoChar[]; label: string; digits: number };

export const ODO_START = 12;
export const ODO_STAGGER = 5;
export const ODO_DECEL = 14;
export const ODO_BOUNCE = 5;

export function statParts(overlay: string): OdoParts | null {
  const m = overlay.match(/^\s*([\d.,]+)(.*)$/);
  if (!m) return null;
  const num = m[1]!.replace(/[.,]+$/, '');
  const digits = (num.match(/\d/g) ?? []).length;
  if (digits === 0 || digits > 6) return null;
  const chars = num.split('').map((ch) => ({ ch, digit: /\d/.test(ch) ? Number(ch) : null }));
  return { chars, label: (m[2] ?? '').trim(), digits };
}

export function odoLockFrame(i: number): number {
  return ODO_START + i * ODO_STAGGER + ODO_DECEL + ODO_BOUNCE;
}

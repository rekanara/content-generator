import { Easing, interpolate } from 'remotion';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const h = (n: number) => {
  const s = Math.sin(n * 127.3) * 43758.5453;
  return s - Math.floor(s);
};

export function impactShake(local: number, at: number, amount = 10): { x: number; y: number } {
  if (local < at || local >= at + 5) return { x: 0, y: 0 };
  const t = local - at;
  const amp = amount * Math.exp(-t * 0.9);
  return { x: amp * (h(local * 7 + 1) * 2 - 1), y: amp * (h(local * 13 + 2) * 2 - 1) };
}

export function ImpactRing({ local, at, color, cx = 540, cy = 960 }: { local: number; at: number; color: string; cx?: number; cy?: number }) {
  if (local < at || local >= at + 14) return null;
  const p = interpolate(local, [at, at + 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const lin = interpolate(local, [at, at + 14], [0, 1], clamp);
  const d = interpolate(p, [0, 1], [80, 860]);
  const opacity = interpolate(lin, [0, 0.65, 1], [0.75, 0.55, 0], clamp);
  return <div style={{ position: 'absolute', left: cx - d / 2, top: cy - d / 2, width: d, height: d, borderRadius: '50%', border: `6px solid ${color}`, opacity, boxSizing: 'border-box', pointerEvents: 'none' }} />;
}

export function Dust({ local, at, color, cx = 540, cy = 960 }: { local: number; at: number; color: string; cx?: number; cy?: number }) {
  if (local < at || local >= at + 16) return null;
  const p = interpolate(local, [at, at + 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const lin = interpolate(local, [at, at + 16], [0, 1], clamp);
  return <>{Array.from({ length: 8 }).map((_, i) => {
    const ang = (i / 8) * Math.PI * 2 + (h(i + 3) - 0.5) * 0.7;
    const dist = 160 + h(i + 11) * 160;
    const size = 18 + h(i + 23) * 12;
    const dx = Math.cos(ang) * dist * p;
    const dy = Math.sin(ang) * dist * p + 90 * p * p;
    const s = size * (1 - 0.75 * lin);
    const opacity = interpolate(lin, [0, 0.75, 1], [0.8, 0.5, 0], clamp);
    return <div key={i} style={{ position: 'absolute', left: cx + dx - s / 2, top: cy + dy - s / 2, width: s, height: s, background: color, opacity, borderRadius: 2, pointerEvents: 'none' }} />;
  })}</>;
}

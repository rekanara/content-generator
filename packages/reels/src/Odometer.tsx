import { Easing, interpolate } from 'remotion';
import type { ReelsTheme } from './theme.ts';
import { ODO_BOUNCE, ODO_DECEL, ODO_START, ODO_STAGGER, odoLockFrame, type OdoParts } from './odometer.ts';

const SPIN = 0.85;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

function posAt(f: number, i: number, digit: number): number {
  const s = ODO_START + i * ODO_STAGGER;
  const p0 = SPIN * s;
  const T = Math.ceil((p0 + 6 - digit) / 10) * 10 + digit;
  if (f < s) return SPIN * Math.max(f, 0);
  if (f < s + ODO_DECEL) return interpolate(f, [s, s + ODO_DECEL], [p0, T + 0.5], { ...clamp, easing: Easing.out(Easing.cubic) });
  if (f < s + ODO_DECEL + ODO_BOUNCE) return interpolate(f, [s + ODO_DECEL, s + ODO_DECEL + ODO_BOUNCE], [T + 0.5, T], { ...clamp, easing: Easing.out(Easing.cubic) });
  return T;
}

function Strip({ pos, row, width, fs, color, opacity = 1, dy = 0 }: { pos: number; row: number; width: number; fs: number; color: string; opacity?: number; dy?: number }) {
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width, transform: `translateY(${-(pos % 10) * row + dy}px)`, opacity }}>
      {Array.from({ length: 20 }).map((_, k) => (
        <div key={k} style={{ width, height: row, lineHeight: `${row}px`, textAlign: 'center', fontSize: fs, letterSpacing: -fs * 0.04, color }}>{k % 10}</div>
      ))}
    </div>
  );
}

function Reel({ frame, i, digit, row, width, fs, color }: { frame: number; i: number; digit: number; row: number; width: number; fs: number; color: string }) {
  const pos = posAt(frame, i, digit);
  const speed = Math.abs(pos - posAt(frame - 1, i, digit));
  const gate = interpolate(speed, [0.06, 0.5], [0, 1], clamp);
  return (
    <div style={{ position: 'relative', width, height: row, overflow: 'hidden' }}>
      {gate > 0.001 && (
        <>
          <Strip pos={pos} row={row} width={width} fs={fs} color={color} opacity={0.25 * gate} dy={row * 0.5} />
          <Strip pos={pos} row={row} width={width} fs={fs} color={color} opacity={0.12 * gate} dy={-row * 0.5} />
        </>
      )}
      <Strip pos={pos} row={row} width={width} fs={fs} color={color} />
    </div>
  );
}

export function Odometer({ parts, theme, local, left, right, sceneLen }: { parts: OdoParts; theme: ReelsTheme; local: number; left: number; right: number; sceneLen: number }) {
  const DW = 0.62;
  const SW = 0.32;
  const em = parts.chars.reduce((a, c) => a + (c.digit === null ? SW : DW), 0);
  const fs = Math.min(260 * theme.font.scale, (1080 - left - right) / em);
  const row = fs * 1.02;
  const lastLock = odoLockFrame(parts.digits - 1);
  const lock = Math.min(lastLock, Math.max(8, Math.floor(sceneLen * 0.7)));
  const pulse = interpolate(local, [lock, lock + 4, lock + 8], [1, 1.035, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const labelOp = interpolate(local, [lock - 6, lock + 10], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
  const barW = interpolate(local, [lock - 6, lock + 14], [0, 260], { ...clamp, easing: Easing.out(Easing.cubic) });
  let di = 0;
  return (
    <div style={{ position: 'absolute', left, right, top: 330, textAlign: 'left' }}>
      <div aria-label={parts.chars.map((c) => c.ch).join('')} style={{ display: 'flex', fontWeight: theme.font.weight, transform: `scale(${pulse})`, transformOrigin: '0 50%' }}>
        {parts.chars.map((c, k) => c.digit === null
          ? <div key={k} style={{ width: fs * SW, height: row, lineHeight: `${row}px`, textAlign: 'center', fontSize: fs, color: theme.palette.accent }}>{c.ch}</div>
          : <Reel key={k} frame={local} i={di++} digit={c.digit} row={row} width={fs * DW} fs={fs} color={theme.palette.accent} />)}
      </div>
      <div style={{ width: barW, height: 18, marginTop: 20, background: theme.palette.text }} />
      <div style={{ fontSize: 66, fontWeight: theme.font.weight, color: theme.palette.text, marginTop: 34, lineHeight: 1.02, opacity: labelOp }}>
        {theme.captions.case === 'upper' ? parts.label.toUpperCase() : parts.label}
      </div>
    </div>
  );
}

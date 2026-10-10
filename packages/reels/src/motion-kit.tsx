import { Easing, interpolate, spring } from 'remotion';
import type { ReelsTheme } from './theme.ts';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/';
const hash = (n: number) => {
  const s = Math.sin(n * 127.3) * 43758.5453;
  return s - Math.floor(s);
};

export function variant(index: number, salt = 0): number {
  return Math.floor(hash(index * 97 + salt) * 6);
}

export function WordReveal({ text, local, theme, size, align = 'left', mode }: { text: string; local: number; theme: ReelsTheme; size: number; align?: 'left' | 'center'; mode: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  if (mode === 1) return <ScrambleText text={text} local={local} theme={theme} size={size} align={align} />;
  if (mode === 2) return <SplitRise words={words} local={local} theme={theme} size={size} align={align} />;
  if (mode === 3) return <TrackingExpand text={text} local={local} theme={theme} size={size} align={align} />;
  if (mode === 4) return <GradientSweep text={text} local={local} theme={theme} size={size} align={align} />;
  if (mode === 5) return <MarkerUnderline words={words} local={local} theme={theme} size={size} align={align} />;
  return <BlurWords words={words} local={local} theme={theme} size={size} align={align} />;
}

function BlurWords({ words, local, theme, size, align }: { words: string[]; local: number; theme: ReelsTheme; size: number; align: 'left' | 'center' }) {
  void size;
  return <div style={{ textAlign: align }}>{words.map((w, i) => {
    const p = interpolate(local - i * 2, [0, 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    return <span key={i} style={{ display: 'inline-block', marginRight: '0.24em', opacity: p, color: theme.palette.text, filter: `blur(${(1 - p) * 10}px)`, transform: `translateY(${(1 - p) * 42}px)` }}>{w}</span>;
  })}</div>;
}

function SplitRise({ words, local, theme, size, align }: { words: string[]; local: number; theme: ReelsTheme; size: number; align: 'left' | 'center' }) {
  void size;
  const chars = words.join(' ').split('');
  return <div aria-label={words.join(' ')} style={{ textAlign: align }}>{chars.map((ch, i) => {
    if (ch === ' ') return <span key={i}> </span>;
    const p = interpolate(local - i * 1.5, [0, 12, 18], [0, 1.08, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    return <span key={i} aria-hidden style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top' }}><span style={{ display: 'inline-block', color: i % 7 === 0 ? theme.palette.accent : theme.palette.text, transform: `translateY(${(1 - p) * 115}%)` }}>{ch}</span></span>;
  })}</div>;
}

function ScrambleText({ text, local, theme, size, align }: { text: string; local: number; theme: ReelsTheme; size: number; align: 'left' | 'center' }) {
  void size;
  const chars = text.split('');
  return <div style={{ textAlign: align, fontVariantNumeric: 'tabular-nums' }}>{chars.map((ch, i) => {
    if (ch === ' ') return <span key={i}> </span>;
    const lock = 8 + i * 3 + hash(i * 7) * 5;
    const locked = local >= lock;
    const flash = locked ? interpolate(local - lock, [0, 4, 10], [1, 0.4, 0], clamp) : 0;
    const shown = locked ? ch : POOL[Math.floor(hash(i * 131 + Math.floor(local / 2)) * POOL.length)] ?? ch;
    return <span key={i} style={{ display: 'inline-block', width: /[ilI.,]/.test(ch) ? '0.5em' : '0.72em', color: locked ? theme.palette.text : theme.palette.muted, background: flash > 0.5 ? theme.palette.accent : undefined, textShadow: `0 0 ${flash * 22}px ${theme.palette.accent}` }}>{shown}</span>;
  })}</div>;
}

function TrackingExpand({ text, local, theme, size, align }: { text: string; local: number; theme: ReelsTheme; size: number; align: 'left' | 'center' }) {
  void size;
  const chars = text.split('');
  const p = interpolate(local, [0, 42], [0, 1], { ...clamp, easing: Easing.out(Easing.poly(5)) });
  const mid = (chars.length - 1) / 2;
  return <div aria-label={text} style={{ textAlign: align, filter: `blur(${(1 - p) * 8}px)`, opacity: 0.65 + p * 0.35 }}>{chars.map((ch, i) => <span key={i} aria-hidden style={{ display: 'inline-block', color: theme.palette.text, transform: `translateX(${(i - mid) * (1 - p) * -24}px) scaleX(${0.92 + p * 0.08})` }}>{ch}</span>)}</div>;
}

function GradientSweep({ text, local, theme, size, align }: { text: string; local: number; theme: ReelsTheme; size: number; align: 'left' | 'center' }) {
  void size;
  const x = interpolate(local, [0, 26], [-120, 120], clamp);
  return <div style={{ textAlign: align, color: theme.palette.text, background: `linear-gradient(92deg, ${theme.palette.text}, ${theme.palette.accent}, ${theme.palette.text})`, backgroundSize: '220% 100%', backgroundPosition: `${x}% 0`, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', textShadow: local < 34 ? `0 0 24px ${theme.palette.accent}66` : 'none' }}>{text}</div>;
}

function MarkerUnderline({ words, local, theme, size, align }: { words: string[]; local: number; theme: ReelsTheme; size: number; align: 'left' | 'center' }) {
  const p = spring({ frame: local, fps: 30, config: { damping: 14, stiffness: 110 } });
  const draw = interpolate(local, [22, 38], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return <div style={{ textAlign: align, transform: `translateY(${(1 - p) * 38}px)`, opacity: p }}>{words.join(' ')}<div style={{ width: `${draw * 72}%`, height: Math.max(8, size * 0.08), marginTop: 16, borderRadius: 999, background: theme.palette.accent, transform: 'rotate(-1.5deg)', transformOrigin: align === 'center' ? '50% 50%' : '0 50%' }} /></div>;
}

export function Marquee({ text, local, theme }: { text: string; local: number; theme: ReelsTheme }) {
  const rows = [0, 1, 2];
  return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.16, pointerEvents: 'none' }}>{rows.map((r) => {
    const y = 350 + r * 210;
    const dir = r % 2 ? -1 : 1;
    const x = ((local * dir * 8) % 640) - 640;
    return <div key={r} style={{ position: 'absolute', left: x, top: y, whiteSpace: 'nowrap', fontSize: 132, lineHeight: 1, fontWeight: theme.font.weight, color: 'transparent', WebkitTextStroke: `2px ${theme.palette.accent}` }}>{Array.from({ length: 8 }, (_, i) => <span key={i} style={{ marginRight: 48 }}>{text}</span>)}</div>;
  })}</div>;
}

export function SoftAurora({ frame, theme }: { frame: number; theme: ReelsTheme }) {
  const a = frame * 0.012;
  return <div style={{ position: 'absolute', inset: -220, opacity: 0.28, filter: 'blur(44px)', background: `radial-gradient(circle at ${45 + Math.sin(a) * 18}% ${70 + Math.cos(a * 0.8) * 12}%, ${theme.palette.accent}, transparent 34%), radial-gradient(circle at ${70 + Math.cos(a) * 12}% ${30 + Math.sin(a * 1.2) * 18}%, ${theme.palette.bg2}, transparent 38%)` }} />;
}

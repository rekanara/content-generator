import { useEffect } from 'react';
import { AbsoluteFill, Easing, Img, interpolate, Loop, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig, continueRender, delayRender } from 'remotion';
import { sceneAtFrame, type ReelsTimeline, type TimelineScene } from './timeline.ts';
import { DEFAULT_THEME, type ReelsTheme } from './theme.ts';
import { fontStack, loadReelFont } from './fonts.ts';

export type ReelsBackground = { type: 'image' | 'video'; src: string };
export type ReelsVideoProps = { timeline: ReelsTimeline; theme?: ReelsTheme; background?: ReelsBackground };

type Ctx = { theme: ReelsTheme; frame: number; local: number; fps: number; scene: TimelineScene; total: number; background?: ReelsBackground };

const up = (t: ReelsTheme, s: string) => (t.captions.case === 'upper' ? s.toUpperCase() : s);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const easeOut = Easing.out(Easing.cubic);
const easeInOut = Easing.inOut(Easing.cubic);
const easeOutExpo = Easing.bezier(0.16, 1, 0.3, 1);
// 9:16 safe area (IG/TikTok/Shorts UI): top 120, right rail 120, bottom 320 kept clear.
const SAFE = { l: 90, r: 140, t: 140, b: 330 } as const;
const PUNCH_AT = [0.45, 0.6, 0.5, 0.55] as const;

// Smart chunking: 4-6 words per line, punctuation-aware (breaks after comma/period), current chunk fades in.
function chunkWords(words: { text: string; startFrame: number; endFrame: number }[], min = 4, max = 6): { text: string; start: number; end: number }[][] {
  const chunks: { text: string; start: number; end: number }[][] = [];
  let line: { text: string; start: number; end: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    line.push({ text: words[i]!.text, start: words[i]!.startFrame, end: words[i]!.endFrame });
    const isPunct = /[,;.!?]$/.test(words[i]!.text);
    const full = line.length >= max;
    const ready = line.length >= min && (isPunct || i === words.length - 1);
    if (full || ready) { chunks.push([...line]); line = []; }
  }
  if (line.length > 0) chunks.push(line);
  return chunks;
}

function Captions({ theme, frame, scene, local, fps }: Ctx) {
  if (theme.captions.style === 'none' || scene.words.length === 0) return null;
  const top = theme.captions.position === 'top' ? 230 : theme.captions.position === 'center' ? 980 : 1290;
  const y = scene.index === 0 ? 0 : interpolate(local, [0, fps * 0.35], [28, 0], { ...clamp, easing: easeOut });
  if (theme.captions.style === 'line') {
    const s = scene.index === 0 ? 1 : spring({ frame: local - 5, fps, config: { damping: 18, stiffness: 130 } });
    return <div style={{ position: 'absolute', left: SAFE.l, right: SAFE.r, top, textAlign: 'center', fontSize: 50, lineHeight: 1.16, fontWeight: theme.font.weight, color: theme.palette.text, opacity: s, transform: `translateY(${(1 - s) * 28}px)`, textShadow: '0 6px 20px rgba(0,0,0,.36)' }}>{up(theme, scene.narration)}</div>;
  }
  const chunks = chunkWords(scene.words, 4, 6);
  const chunk = chunks.find((c) => frame >= c[0]!.start && frame < c.at(-1)!.end) ?? chunks.find((c) => frame < c[0]!.start) ?? chunks.at(-1);
  if (!chunk) return null;
  const chunkStart = Math.min(frame, chunk[0]!.start);
  const chunkFade = interpolate(frame - chunkStart, [0, fps * 0.15], [0, 1], clamp);
  return (
    <div style={{ position: 'absolute', left: SAFE.l, right: SAFE.r, top, textAlign: 'center', transform: `translateY(${y}px)`, opacity: chunkFade }}>
      {chunk.map((w) => {
        const on = frame >= w.start && frame < w.end;
        const said = frame >= w.end;
        const wordLocal = frame - w.start;
        const hit = on ? spring({ frame: wordLocal, fps, config: { damping: 10, stiffness: 240 } }) : 0;
        return (
          <span key={`${w.start}-${w.text}`} style={{
            display: 'inline-block', margin: '0 6px 8px', padding: '6px 10px', borderRadius: 6, fontSize: 54, lineHeight: 1.08, fontWeight: theme.font.weight,
            color: on ? theme.palette.bg : said ? theme.palette.text : theme.palette.muted,
            background: on ? theme.palette.accent : 'transparent',
            transform: `scale(${on ? 1 + hit * 0.06 : 1})`, textShadow: on ? 'none' : '0 4px 16px rgba(0,0,0,.5)',
          }}>{up(theme, w.text)}</span>
        );
      })}
    </div>
  );
}

// Auto layout: long overlay → multi-line, key word accent.
function breakLines(text: string, maxChars = 32): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (test.length > maxChars && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [text];
}

function Headline({ theme, local, fps, scene }: Ctx, size: number, top: number, align: 'left' | 'center' = 'left') {
  const text = up(theme, scene.overlay_text);
  const lines = breakLines(text, 32);
  const allWords = text.split(/\s+/);
  const key = allWords.reduce((best, w, i) => (w.length > allWords[best]!.length ? i : best), 0);
  const keyWord = allWords[key];
  const dur = Math.round(fps * 0.5);
  const totalWords = allWords.length;
  const step = totalWords > 1 ? Math.max(1, Math.min(2, Math.floor((fps * 0.8 - dur) / (totalWords - 1)))) : 0;
  let wordIdx = 0;
  return (
    <div aria-label={text} style={{ position: 'absolute', left: SAFE.l, right: SAFE.r, top, textAlign: align }}>
      {lines.map((ln, li) => {
        const words = ln.split(/\s+/);
        const lineEl = (
          <div key={li} style={{ fontSize: size * theme.font.scale, lineHeight: 1.05, fontWeight: theme.font.weight, letterSpacing: '-0.03em', color: theme.palette.text, marginBottom: li < lines.length - 1 ? 12 : 0 }}>
            {words.map((w, wi) => {
              const idx = wordIdx++;
              const p = scene.index === 0 ? 1 : interpolate(local - idx * step, [0, dur], [0, 1], { ...clamp, easing: easeOutExpo });
              return (
                <span key={wi} aria-hidden style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', marginRight: '0.22em', paddingBottom: '0.06em' }}>
                  <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 110}%)`, color: w === keyWord && totalWords > 2 ? theme.palette.accent : undefined }}>{w}</span>
                </span>
              );
            })}
          </div>
        );
        return lineEl;
      })}
    </div>
  );
}

function Stat(ctx: Ctx) {
  const { theme, local, fps, scene } = ctx;
  const m = scene.overlay_text.match(/^\s*([\d.,]+)(.*)$/);
  const target = m ? Number(m[1]!.replace(/\./g, '').replace(',', '.')) : NaN;
  if (!Number.isFinite(target)) return Headline(ctx, 96, 420);
  const p = interpolate(local, [0, fps * 0.95], [0, 1], { ...clamp, easing: easeOut });
  const shown = Number.isInteger(target) ? Math.round(target * p).toLocaleString('id-ID') : (target * p).toFixed(1);
  const s = spring({ frame: local, fps, config: { damping: 11, stiffness: 150 } });
  return (
    <div style={{ position: 'absolute', left: SAFE.l, right: SAFE.r, top: 330, textAlign: 'left', transform: `translateY(${(1 - s) * 40}px)`, opacity: s }}>
      <div style={{ fontSize: 260 * theme.font.scale, fontWeight: theme.font.weight, color: theme.palette.accent, letterSpacing: -12, lineHeight: 0.88 }}>{shown}</div>
      <div style={{ width: 260, height: 18, marginTop: 28, background: theme.palette.text }} />
      <div style={{ fontSize: 66, fontWeight: theme.font.weight, color: theme.palette.text, marginTop: 34, lineHeight: 1.02 }}>{up(theme, (m![2] ?? '').trim())}</div>
    </div>
  );
}

function Quote(ctx: Ctx) {
  const { theme, local, fps } = ctx;
  const s = spring({ frame: local, fps, config: { damping: 13, stiffness: 130 } });
  return (
    <>
      <div style={{ position: 'absolute', left: 70, top: 260, width: 180, height: 180, borderRadius: 6, background: theme.palette.accent, transform: `rotate(${-8 + s * 8}deg) scale(${0.75 + s * 0.25})` }} />
      <div style={{ position: 'absolute', left: 104, top: 238, fontSize: 230, lineHeight: 1, color: theme.palette.bg, fontWeight: theme.font.weight }}>“</div>
      {Headline(ctx, 78, 520)}
    </>
  );
}

function Cta(ctx: Ctx) {
  const { theme, local, fps } = ctx;
  const s = spring({ frame: local, fps, config: { damping: 10, stiffness: 140 } });
  return (
    <div style={{ position: 'absolute', left: SAFE.l, right: SAFE.r, top: 500, padding: 58, borderRadius: 14, background: theme.palette.text, transform: `translateY(${(1 - s) * 80}px) rotate(${(1 - s) * 1.5}deg)`, opacity: s, textAlign: 'left', boxShadow: `-14px 14px 0 ${theme.palette.accent}` }}>
      <div style={{ fontSize: 86 * theme.font.scale, fontWeight: theme.font.weight, lineHeight: 0.98, letterSpacing: -3, color: theme.palette.bg }}>{up(theme, ctx.scene.overlay_text)}</div>
      {theme.brand.handle && <div style={{ marginTop: 34, fontSize: 44, fontWeight: theme.font.weight, color: theme.palette.accent }}>{theme.brand.handle}</div>}
    </div>
  );
}

function TutorialStep(ctx: Ctx) {
  const { theme, local, fps, scene } = ctx;
  const s = spring({ frame: local, fps, config: { damping: 12, stiffness: 130 } });
  return (
    <div style={{ position: 'absolute', left: SAFE.l, right: SAFE.r, top: 350, textAlign: 'left', transform: `translateY(${(1 - s) * 46}px)`, opacity: s }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 122, height: 122, borderRadius: 18, background: theme.palette.accent, color: theme.palette.bg, fontSize: 64, fontWeight: theme.font.weight, marginBottom: 34 }}>{scene.step ?? ''}</div>
      <div style={{ fontSize: 92 * theme.font.scale, lineHeight: 1.02, fontWeight: theme.font.weight, color: theme.palette.text, letterSpacing: '-0.035em' }}>{up(theme, scene.overlay_text)}</div>
      {scene.note && <div style={{ marginTop: 30, fontSize: 38, lineHeight: 1.25, color: theme.palette.muted }}>{scene.note}</div>}
    </div>
  );
}

function TutorialCode(ctx: Ctx) {
  const { theme, local, fps, scene } = ctx;
  const text = scene.code ?? '';
  const chars = Math.floor(interpolate(local, [0, fps * 1.2], [0, text.length], clamp));
  const shown = text.slice(0, chars);
  const lines = shown.split('\n');
  return (
    <div style={{ position: 'absolute', left: SAFE.l, right: SAFE.r, top: 270, textAlign: 'left' }}>
      <div style={{ marginBottom: 26, fontSize: 48, lineHeight: 1.12, fontWeight: theme.font.weight, color: theme.palette.text }}>{scene.step ? `STEP ${scene.step}` : 'COMMAND'}</div>
      <pre style={{ margin: 0, minHeight: 520, padding: 34, borderRadius: 18, background: '#05080c', border: `2px solid ${theme.palette.accent}66`, boxShadow: `-10px 10px 0 ${theme.palette.accent}33`, color: theme.palette.text, fontFamily: '"JetBrains Mono", "SFMono-Regular", Menlo, monospace', fontSize: 36, lineHeight: 1.42, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {lines.map((ln, i) => <span key={i}>{ln.startsWith('$') ? <><span style={{ color: theme.palette.accent }}>$</span>{ln.slice(1)}</> : ln}{i < lines.length - 1 ? '\n' : ''}</span>)}<span style={{ color: theme.palette.accent }}>{local % 24 < 12 ? '▌' : ''}</span>
      </pre>
      {scene.note && <div style={{ marginTop: 22, padding: '18px 22px', borderLeft: `8px solid ${theme.palette.accent}`, background: `${theme.palette.accent}22`, fontSize: 32, lineHeight: 1.3, color: theme.palette.text }}>{scene.note}</div>}
    </div>
  );
}

function SceneBody(ctx: Ctx) {
  const v = ctx.scene.visual;
  if (v === 'code') return TutorialCode(ctx);
  if (v === 'step') return TutorialStep(ctx);
  if (v === 'stat') return Stat(ctx);
  if (v === 'quote') return Quote(ctx);
  if (v === 'cta') return Cta(ctx);
  return Headline(ctx, v === 'hook' ? 122 : 96, v === 'hook' ? 330 : 410, ctx.theme.layout === 'minimal' ? 'center' : 'left');
}

// Media treatment: pan/zoom, blur edge, vignette, subject-safe overlay.
function MediaBackground({ background, total, frame }: { background?: ReelsBackground; total: number; frame: number }) {
  if (!background) return null;
  const drift = (frame / Math.max(1, total)) * 0.08;
  const zoom = 1.1 + Math.sin((frame / Math.max(1, total)) * Math.PI * 2) * 0.02;
  const pan = `${50 + drift * 10}% ${50 - drift * 8}%`;
  const src = staticFile(background.src);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', inset: -60, overflow: 'hidden' }}>
        {background.type === 'video'
          ? <Loop durationInFrames={total}><OffthreadVideo src={src} muted style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: pan, transform: `scale(${zoom})`, filter: 'saturate(.8) contrast(1.1) brightness(.5)' }} /></Loop>
          : <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: pan, transform: `scale(${zoom})`, filter: 'saturate(.8) contrast(1.1) brightness(.5)' }} />}
      </div>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 65% 50% at 50% 45%, transparent 30%, rgba(0,0,0,.5) 85%)' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.22), rgba(0,0,0,.68))' }} />
      <div style={{ position: 'absolute', inset: 0, backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)', opacity: 0.4 }} />
    </AbsoluteFill>
  );
}

function Background({ theme, frame, total, scene, local, fps, background }: Ctx) {
  const d = frame / Math.max(1, total);
  const len = scene.endFrame - scene.startFrame;
  const cut = interpolate(local, [0, Math.min(fps * 0.55, len)], [0, 1], { ...clamp, easing: easeOut });
  const drift = interpolate(local, [0, Math.max(1, len)], [0, 1], { ...clamp, easing: easeInOut });
  const { bg, bg2, accent, text } = theme.palette;
  const media = <MediaBackground background={background} total={total} frame={frame} />;
  const grain = `repeating-radial-gradient(circle at ${Math.round(d * 100)}% ${Math.round((1 - d) * 100)}%, rgba(255,255,255,.06) 0 1px, transparent 1px 5px)`;
  if (theme.layout === 'minimal') {
    return <AbsoluteFill style={{ background: bg }}>{media}<div style={{ position: 'absolute', left: 60, right: 60, top: 80, bottom: 80, border: `2px solid ${text}22`, transform: `scale(${1 + drift * 0.018})` }} /></AbsoluteFill>;
  }
  if (theme.layout === 'news') {
    return (
      <AbsoluteFill style={{ background: bg }}>
        {media}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 270, background: text, transform: `translateY(${(1 - cut) * -270}px)` }} />
        <div style={{ position: 'absolute', left: SAFE.l, top: 168, fontSize: 48, fontWeight: theme.font.weight, color: bg, letterSpacing: 3 }}>BERITA</div>
        <div style={{ position: 'absolute', left: 0, top: 270, width: `${20 + cut * 80}%`, height: 12, background: accent }} />
        <div style={{ position: 'absolute', inset: 0, background: grain, opacity: 0.28 }} />
      </AbsoluteFill>
    );
  }
  if (theme.layout === 'split') {
    return (
      <AbsoluteFill style={{ background: bg }}>
        {media}
        <div style={{ position: 'absolute', left: -120, right: -120, bottom: -90, height: 840, background: background ? `${bg2}dd` : bg2, borderTop: `14px solid ${accent}`, transform: `translateY(${(1 - cut) * 260}px) rotate(-3deg)` }} />
        <div style={{ position: 'absolute', inset: 0, background: grain, opacity: 0.18 }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: bg }}>
      {media}
      <div style={{ position: 'absolute', inset: -220, opacity: background ? 0.38 : 1, background: `linear-gradient(120deg, ${bg}, ${bg2} 56%, ${bg})`, transform: `translateX(${(drift - 0.5) * 90}px) rotate(${(d - 0.5) * 3}deg) scale(1.08)` }} />
      <div style={{ position: 'absolute', left: -120 + drift * 120, top: 210, width: 820, height: 820, border: `28px solid ${accent}`, opacity: 0.3, transform: `rotate(${local * 0.12}deg)` }} />
      <div style={{ position: 'absolute', right: -180, bottom: 180 - drift * 110, width: 560, height: 560, background: accent, opacity: 0.18, transform: `rotate(${-12 - local * 0.08}deg)` }} />
      <div style={{ position: 'absolute', inset: 0, background: grain, opacity: 0.22 }} />
    </AbsoluteFill>
  );
}

export function ReelsVideo({ timeline, theme = DEFAULT_THEME, background }: ReelsVideoProps) {
  useEffect(() => {
    const handle = delayRender();
    loadReelFont(theme.font.family, theme.font.weight).waitUntilDone().then(() => continueRender(handle), () => continueRender(handle));
  }, [theme.font.family, theme.font.weight]);

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scene = sceneAtFrame(timeline, frame);
  const local = frame - scene.startFrame;
  const total = timeline.durationInFrames;
  const ctx: Ctx = { theme, frame, local, fps, scene, total, background };
  const tf = Math.max(1, theme.transition.durationFrames);
  const len = scene.endFrame - scene.startFrame;
  const fadeIn = theme.transition.durationFrames === 0 || scene.index === 0 ? 1 : interpolate(local, [0, tf], [0, 1], { ...clamp, easing: easeOut });
  const fadeOut = theme.transition.durationFrames === 0 || scene.index === timeline.scenes.length - 1 ? 1 : interpolate(local, [len - tf, len], [1, 0.05], clamp);
  const wipe = interpolate(local, [0, tf * 1.4], [0, 1], { ...clamp, easing: easeOut });
  const punchAt = Math.round(len * PUNCH_AT[scene.index % PUNCH_AT.length]!);
  const punch = len < fps * 2 ? 1 : interpolate(spring({ frame: local - punchAt, fps, config: { damping: 12, stiffness: 200 } }), [0, 1], [1, 1.05]);

  return (
    <AbsoluteFill style={{ overflow: 'hidden', fontFamily: fontStack(theme.font.family), color: theme.palette.text }}>
      <Background {...ctx} />
      <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut), transform: `translate3d(${(1 - fadeIn) * 86}px, 0, 0) scale(${(1 + (1 - fadeIn) * 0.025) * punch})`, transformOrigin: '50% 40%' }}>
        {scene.visual !== 'cta' && theme.layout !== 'minimal' && theme.layout !== 'news' && <div style={{ position: 'absolute', left: SAFE.l, top: 284, width: 116, height: 14, background: theme.palette.accent, transform: `scaleX(${wipe})`, transformOrigin: 'left' }} />}
        <SceneBody {...ctx} />
      </AbsoluteFill>
      <Captions {...ctx} />
      {scene.index > 0 && local < 8 && (
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '100%', background: theme.palette.accent, transform: `translateX(${interpolate(local, [0, 8], [-100, 100], { ...clamp, easing: easeInOut })}%) skewX(-12deg)`, opacity: 0.9 }} />
      )}
      <div style={{ position: 'absolute', top: theme.layout === 'news' ? 290 : SAFE.t, right: SAFE.r, fontSize: 32, fontWeight: theme.font.weight, color: theme.palette.muted, fontVariantNumeric: 'tabular-nums', letterSpacing: 1 }}>{String(scene.index + 1).padStart(2, '0')}/{String(timeline.scenes.length).padStart(2, '0')}</div>
      {theme.brand.handle && scene.visual !== 'cta' && <div style={{ position: 'absolute', left: SAFE.l, [theme.brand.position === 'top' ? 'top' : 'bottom']: theme.brand.position === 'top' ? (theme.layout === 'news' ? 290 : SAFE.t) : SAFE.b, fontSize: 34, fontWeight: theme.font.weight, color: theme.palette.muted }}>{theme.brand.handle}</div>}
      {theme.progressBar && (
        <div style={{ position: 'absolute', left: SAFE.l, right: SAFE.r, bottom: SAFE.b - 30, height: 6, background: 'rgba(255,255,255,.14)' }}>
          <div style={{ width: `${(frame / Math.max(1, total - 1)) * 100}%`, height: '100%', background: theme.palette.accent }} />
        </div>
      )}
    </AbsoluteFill>
  );
}

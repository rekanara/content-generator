// Template presets: hand-picked theme combinations for quick starts.
import type { ReelsTheme } from './theme.ts';

export const PRESETS: Record<string, { name: string; theme: ReelsTheme }> = {
  'editorial-news': {
    name: 'Editorial News',
    theme: {
      layout: 'news',
      palette: { bg: '#0a0a0a', bg2: '#1a1715', text: '#f8f8f6', muted: '#9a968e', accent: '#ff4d2e' },
      font: { family: 'Fraunces', weight: 900, scale: 1 },
      captions: { style: 'word-highlight', position: 'bottom', case: 'preserve' },
      transition: { durationFrames: 12 },
      progressBar: true,
      brand: { handle: '', position: 'bottom' },
    },
  },
  'brutalist-dev': {
    name: 'Brutalist Dev',
    theme: {
      layout: 'minimal',
      palette: { bg: '#000000', bg2: '#1a1a1a', text: '#ffffff', muted: '#808080', accent: '#00ff41' },
      font: { family: 'JetBrains Mono', weight: 800, scale: 0.95 },
      captions: { style: 'word-highlight', position: 'bottom', case: 'upper' },
      transition: { durationFrames: 0 },
      progressBar: false,
      brand: { handle: '', position: 'bottom' },
    },
  },
  'policy-brief': {
    name: 'Policy Brief',
    theme: {
      layout: 'split',
      palette: { bg: '#1e1e24', bg2: '#2f2f38', text: '#e8e6e3', muted: '#b0aea8', accent: '#4a90e2' },
      font: { family: 'DM Serif Display', weight: 400, scale: 1.05 },
      captions: { style: 'line', position: 'bottom', case: 'preserve' },
      transition: { durationFrames: 15 },
      progressBar: true,
      brand: { handle: '', position: 'top' },
    },
  },
  'minimal-calm': {
    name: 'Minimal Calm',
    theme: {
      layout: 'minimal',
      palette: { bg: '#faf9f7', bg2: '#e8e6e1', text: '#2a2723', muted: '#7a756d', accent: '#d4a574' },
      font: { family: 'Sora', weight: 800, scale: 0.9 },
      captions: { style: 'word-highlight', position: 'center', case: 'preserve' },
      transition: { durationFrames: 18 },
      progressBar: true,
      brand: { handle: '', position: 'bottom' },
    },
  },
  'kinetic-energy': {
    name: 'Kinetic Energy',
    theme: {
      layout: 'kinetic',
      palette: { bg: '#0f0f14', bg2: '#1e1e28', text: '#fdfcfa', muted: '#8a8883', accent: '#ff6b35' },
      font: { family: 'Bebas Neue', weight: 400, scale: 1.1 },
      captions: { style: 'word-highlight', position: 'bottom', case: 'upper' },
      transition: { durationFrames: 8 },
      progressBar: true,
      brand: { handle: '', position: 'bottom' },
    },
  },
  'soft-editorial': {
    name: 'Soft Editorial',
    theme: {
      layout: 'news',
      palette: { bg: '#f4f1ed', bg2: '#e2dcd3', text: '#1a1714', muted: '#6e6b64', accent: '#8b7355' },
      font: { family: 'Playfair Display', weight: 900, scale: 1 },
      captions: { style: 'line', position: 'bottom', case: 'preserve' },
      transition: { durationFrames: 20 },
      progressBar: false,
      brand: { handle: '', position: 'top' },
    },
  },
};

export const PRESET_ORDER = ['editorial-news', 'brutalist-dev', 'policy-brief', 'minimal-calm', 'kinetic-energy', 'soft-editorial'] as const;

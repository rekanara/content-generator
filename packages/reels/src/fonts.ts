// Bundled Google Fonts — load via @remotion/google-fonts in Remotion render.
// Each font loads once per composition; add fonts below to expose in the UI picker.
import { loadFont as loadAnton } from '@remotion/google-fonts/Anton';
import { loadFont as loadBebasNeue } from '@remotion/google-fonts/BebasNeue';
import { loadFont as loadOswald } from '@remotion/google-fonts/Oswald';
import { loadFont as loadArchivoBlack } from '@remotion/google-fonts/ArchivoBlack';
import { loadFont as loadBarlowCondensed } from '@remotion/google-fonts/BarlowCondensed';
import { loadFont as loadAntonio } from '@remotion/google-fonts/Antonio';
import { loadFont as loadLeagueGothic } from '@remotion/google-fonts/LeagueGothic';
import { loadFont as loadInterTight } from '@remotion/google-fonts/InterTight';
import { loadFont as loadManrope } from '@remotion/google-fonts/Manrope';
import { loadFont as loadPlusJakartaSans } from '@remotion/google-fonts/PlusJakartaSans';
import { loadFont as loadSora } from '@remotion/google-fonts/Sora';
import { loadFont as loadDMSans } from '@remotion/google-fonts/DMSans';
import { loadFont as loadFigtree } from '@remotion/google-fonts/Figtree';
import { loadFont as loadBricolageGrotesque } from '@remotion/google-fonts/BricolageGrotesque';
import { loadFont as loadSpaceGrotesk } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadFraunces } from '@remotion/google-fonts/Fraunces';
import { loadFont as loadPlayfairDisplay } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadDMSerifDisplay } from '@remotion/google-fonts/DMSerifDisplay';
import { loadFont as loadInstrumentSerif } from '@remotion/google-fonts/InstrumentSerif';
import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadSpaceMono } from '@remotion/google-fonts/SpaceMono';
import { loadFont as loadUnbounded } from '@remotion/google-fonts/Unbounded';
import { loadFont as loadSyne } from '@remotion/google-fonts/Syne';
import { loadFont as loadPoppins } from '@remotion/google-fonts/Poppins';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';

export const FONT_CATALOG = [
  { name: 'Anton', family: 'Anton', loader: loadAnton, style: 'normal', weight: '400' },
  { name: 'Bebas Neue', family: 'Bebas Neue', loader: loadBebasNeue, style: 'normal', weight: '400' },
  { name: 'Oswald', family: 'Oswald', loader: loadOswald, style: 'normal', weight: '700' },
  { name: 'Archivo Black', family: 'Archivo Black', loader: loadArchivoBlack, style: 'normal', weight: '400' },
  { name: 'Barlow Condensed', family: 'Barlow Condensed', loader: loadBarlowCondensed, style: 'normal', weight: '800' },
  { name: 'Antonio', family: 'Antonio', loader: loadAntonio, style: 'normal', weight: '700' },
  { name: 'League Gothic', family: 'League Gothic', loader: loadLeagueGothic, style: 'normal', weight: '400' },
  { name: 'Inter Tight', family: 'Inter Tight', loader: loadInterTight, style: 'normal', weight: '800' },
  { name: 'Manrope', family: 'Manrope', loader: loadManrope, style: 'normal', weight: '800' },
  { name: 'Plus Jakarta Sans', family: 'Plus Jakarta Sans', loader: loadPlusJakartaSans, style: 'normal', weight: '800' },
  { name: 'Sora', family: 'Sora', loader: loadSora, style: 'normal', weight: '800' },
  { name: 'DM Sans', family: 'DM Sans', loader: loadDMSans, style: 'normal', weight: '800' },
  { name: 'Figtree', family: 'Figtree', loader: loadFigtree, style: 'normal', weight: '900' },
  { name: 'Bricolage Grotesque', family: 'Bricolage Grotesque', loader: loadBricolageGrotesque, style: 'normal', weight: '800' },
  { name: 'Space Grotesk', family: 'Space Grotesk', loader: loadSpaceGrotesk, style: 'normal', weight: '700' },
  { name: 'Fraunces', family: 'Fraunces', loader: loadFraunces, style: 'normal', weight: '900' },
  { name: 'Playfair Display', family: 'Playfair Display', loader: loadPlayfairDisplay, style: 'normal', weight: '900' },
  { name: 'DM Serif Display', family: 'DM Serif Display', loader: loadDMSerifDisplay, style: 'normal', weight: '400' },
  { name: 'Instrument Serif', family: 'Instrument Serif', loader: loadInstrumentSerif, style: 'normal', weight: '400' },
  { name: 'JetBrains Mono', family: 'JetBrains Mono', loader: loadJetBrainsMono, style: 'normal', weight: '800' },
  { name: 'Space Mono', family: 'Space Mono', loader: loadSpaceMono, style: 'normal', weight: '700' },
  { name: 'Unbounded', family: 'Unbounded', loader: loadUnbounded, style: 'normal', weight: '800' },
  { name: 'Syne', family: 'Syne', loader: loadSyne, style: 'normal', weight: '800' },
  { name: 'Poppins', family: 'Poppins', loader: loadPoppins, style: 'normal', weight: '800' },
  { name: 'Montserrat', family: 'Montserrat', loader: loadMontserrat, style: 'normal', weight: '900' },
] as const;

export type FontEntry = typeof FONT_CATALOG[number];

// Catalog font → bundled loader. Custom name → fetched from Google Fonts CSS at render time
// (any Google Font works by exact name; unknown names fall back to the system font).
// ponytail: custom fonts need network at render; self-host (staticFile) if the Mac mini goes offline.
export function loadReelFont(family: string, weight = 400): { waitUntilDone: () => Promise<void> } {
  const entry = FONT_CATALOG.find((f) => f.family === family);
  if (entry) {
    const loader = entry.loader as (style: 'normal', o: { weights: string[]; subsets: string[] }) => { waitUntilDone: () => Promise<unknown> };
    const { waitUntilDone } = loader('normal', { weights: [entry.weight], subsets: ['latin'] });
    return { waitUntilDone: async () => { await waitUntilDone(); } };
  }
  const name = family.trim();
  if (!name || typeof document === 'undefined' || /[",]/.test(name)) return { waitUntilDone: async () => {} };
  const id = `gf-${name.replace(/\s+/g, '-')}`;
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@${weight}&display=block`;
    document.head.appendChild(link);
  }
  return {
    waitUntilDone: () => new Promise<void>((done) => {
      const link = document.getElementById(id) as HTMLLinkElement;
      const go = () => document.fonts.load(`${weight} 64px "${name}"`).then(() => done(), () => done());
      if (link.sheet) go(); else { link.onload = go; link.onerror = () => done(); }
      setTimeout(done, 8000);
    }),
  };
}

// CSS font-family stack: quoted family + safe fallback.
export const fontStack = (family: string) => (/[",]/.test(family) ? family : `"${family}", "Arial Narrow", sans-serif`);

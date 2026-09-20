// PURE rotation logic — zero imports, zero I/O. Unit-tested in tests/state.test.ts.

export type Platform = 'instagram' | 'linkedin';
export type IgFormat = 'carousel' | 'reels';
export type LiFormat = 'text' | 'pdf';
export type Format = IgFormat | LiFormat;

export type PillarLite = { id: string; is_news: boolean };

export type RotationState = {
  last_platform: Platform;
  last_ig_format: IgFormat | null;
  last_li_format: LiFormat | null;
  last_pillar_id: string | null;
};

export type Slot = {
  platform: Platform;
  format: Format;
  pillar_id: string; // non-news fallback already applied
};

const OTHER: Record<Platform, Platform> = { instagram: 'linkedin', linkedin: 'instagram' };

// Next format for the given platform, based on the last state.
function nextFormat(state: RotationState, platform: Platform): Format {
  if (platform === 'instagram') {
    return state.last_ig_format === 'carousel' ? 'reels' : 'carousel';
  }
  return state.last_li_format === 'pdf' ? 'text' : 'pdf';
}

// Next active pillar (sorted by id), skipping news pillars when RSS is unavailable.
// News pillars are only picked when allowNews=true. If a full pass yields no
// non-news candidate, fall back to a news pillar anyway.
function nextPillar(pillars: PillarLite[], lastId: string | null, allowNews: boolean): string {
  const sorted = [...pillars].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); // uuid v7 time-ordered = chronological
  const eligible = (p: PillarLite) => allowNews || !p.is_news;
  if (sorted.length === 0) throw new Error('no active pillars');

  let start = sorted.findIndex((p) => p.id === lastId);
  for (let i = 1; i <= sorted.length; i++) {
    const cand = sorted[(start + i + sorted.length) % sorted.length]!;
    if (eligible(cand)) return cand.id;
  }
  // every pillar is news and allowNews=false — odd condition, pick any
  return sorted[0]!.id;
}

// Next slot from state. Pillars must already be filtered active-only by the caller.
export function nextSlot(
  state: RotationState,
  pillars: PillarLite[],
  allowNews: boolean,
): Slot {
  const platform = OTHER[state.last_platform];
  const format = nextFormat(state, platform);
  const pillar_id = nextPillar(pillars, state.last_pillar_id, allowNews);
  return { platform, format, pillar_id };
}

// Manual slot from /gen or the frontend: platform required, format optional (follows rotation).
export function forcedSlot(
  state: RotationState,
  pillars: PillarLite[],
  allowNews: boolean,
  platform: Platform,
  format?: Format,
): Slot {
  const natural = nextSlot(state, pillars, allowNews);
  const chosen: Format =
    format ?? (platform === natural.platform ? natural.format : nextFormat(state, platform));
  const pillar_id = format ? natural.pillar_id : nextPillar(pillars, state.last_pillar_id, allowNews);
  return { platform, format: chosen, pillar_id };
}

// New state after this slot is successfully sent.
export function nextState(state: RotationState, slot: Slot): RotationState {
  return {
    last_platform: slot.platform,
    last_ig_format: slot.platform === 'instagram' ? (slot.format as IgFormat) : state.last_ig_format,
    last_li_format: slot.platform === 'linkedin' ? (slot.format as LiFormat) : state.last_li_format,
    last_pillar_id: slot.pillar_id,
  };
}

# Skill: state-management — rotation state machine

When to use: touching `state.ts`, rotation behavior, slot resolution, or anything that decides WHAT gets generated next.

## Core principle

Rotation is **state-based, not date-based**. Missed days don't break the pattern — the next slot is computed purely from the last successful state. `state.ts` is PURE: zero imports, zero I/O, fully unit-tested (13 tests).

## The state

```ts
// db: rotation_state (group_id PK) — updated ONLY in commitSent, after post status = 'sent'
type RotationState = {
  last_platform: Platform;          // 'instagram' | 'linkedin'
  last_ig_format: 'carousel' | 'reels' | null;
  last_li_format: 'text' | 'pdf' | null;
  last_pillar_id: string | null;
};
type Slot = { platform: Platform; format: Format; pillar_id: string };
```

## Slot resolution (nextSlot)

1. **Platform**: always flip — `OTHER[last_platform]`. IG ↔ LinkedIn, no exceptions.
2. **Format** (per platform, alternates): IG: last was carousel → reels, else carousel. LinkedIn: last was pdf → text, else pdf.
3. **Pillar**: round-robin over ACTIVE pillars sorted by id (UUID v7 = chronological). Starts after `last_pillar_id`. News pillars excluded when `allowNews=false`; if all are news, falls back to first.

## Forced slot (manual /gen or FE)

`forcedSlot(state, pillars, allowNews, platform, format?)`:
- platform required, format optional (missing → rotation's natural choice for that platform)
- **format given → keep natural pillar** (don't burn rotation on forced runs)
- format omitted → pillar advances via nextPillar

## Post-slot state (nextState)

Called only after successful send:
```ts
nextState(state, slot) → {
  last_platform: slot.platform,
  last_ig_format: slot.platform === 'instagram' ? slot.format : state.last_ig_format,
  last_li_format: slot.platform === 'linkedin' ? slot.format : state.last_li_format,
  last_pillar_id: slot.pillar_id,
}
```

## Commit path (the invariant)

```
markSent(groupId, postId, slot)
  → nextState(getRotation(groupId))     // pure compute
  → commitSent(groupId, postId, slot, next)  // repos/rotation.ts: post → sent + state, atomic
```

AC #11: failure anywhere before markSent does NOT consume rotation. Generate manual (bot/FE/CLI) DOES advance rotation — same as cron, one source of truth (decision #1).

## News pillar fallback (pipeline level, not state level)

Slot may pick a news pillar. At generate time (`pipeline.ts`): RSS unavailable → swap to first non-news active pillar (slot.pillar_id mutated locally, state unaffected). No non-news pillar → throw.

## Rules for changing this

- Keep `state.ts` pure. DB access stays in `repos/rotation.ts`.
- Any behavior change → update/add tests in `tests/state.test.ts` FIRST (they encode the contract).
- Don't add date parity logic — state-based is a locked decision (SPEC #2).

# AGENTS.md — content-generator operating brief

Source of truth: `SPEC.md`. This file is the quick brief for any AI agent working here. Read SPEC.md for full detail.

## What this is

Daemon (Mac mini) that auto-generates 1 developer-audience post/day per group (Indonesian language) for Instagram/LinkedIn. Output delivered to Telegram chat; Jack uploads manually. NOT multi-agent, NOT auto-posting.

One process: Hono server + node-cron + Telegram bot (polling) + in-process FIFO queue + pipeline (ideation → writer → critic → render → send).

## Monorepo layout

- `apps/server` — daemon (Hono, postgres.js, tsx, no build step)
- `apps/web` — React 19 SPA (Vite, view-switcher state-based, no react-query, no URL router)
- `packages/shared` — zod v4, single FE↔BE contract
- `packages/ui` — tailwind v4 + shadcn-style components

## Hard rules (violations = broken protocol)

1. **Layering**: `api.ts` = transport only (zod parse, cookies, status codes) — ZERO raw SQL. `repos/` = SQL only — zero HTTP. `usecases/` = aggregation. Adapters (`llm.ts`, `tts.ts`, `telegram.ts`, `storage.ts`, `render/`) = external systems.
2. **All PKs UUID v7 strings.** `:id` route params guarded by UUID regex → 400.
3. **SQL always parameterized** via postgres.js tagged template. jsonb inserts: pass object or `${JSON.stringify(x)}::jsonb` — never bare JSON.stringify (double-encode bug, bit us once).
4. **Zod-parse every input** at API boundary via `@workspace/shared`.
5. **State in Postgres.** Queue is in-process; `rotation_state` updated ONLY after post `sent` (spec AC #11 — failure mid-pipeline must not consume rotation).
6. **Secrets**: only read in `config.ts` (env) and `groups.ts` (DB override). Never to log/DB/report/commit.
7. **Pure functions** for testable logic: `state.ts` (zero imports), ffmpeg args, prompt builders, type guards, bot command parser, RSS freshness filter.
8. **`ponytail:` comment** marks deliberate simplification + upgrade path.
9. Max 1 LLM retry per step. No parallel reels render (CPU-bound, queue guarantees serial).
10. Group not visible to user → 404, not 403 (no existence leak).

## Key mechanics

- **Rotation** (`state.ts`, pure): platform alternates IG↔LinkedIn. Format alternates per platform: IG carousel↔reels, LinkedIn pdf↔text. Pillar round-robin by UUID v7 order (chronological). Missed days don't break pattern (state-based, not date parity).
- **Group config resolution** (`groups.ts` `toGroupCfg`): env = fallback, per-group DB columns override (llm_*, tts_*, telegram_*, cron_*).
- **Queue** (`queue.ts`): FIFO, one active run. Cron/bot/FE/CLI all `enqueue()`. Deliver = render-if-needed → telegram send (withRetry 3×/5s) → markSent → post_events. Failure → markFailed + failed event.
- **Audit trail**: `post_events` table (migration 008), events: generated/rendered/sent/failed/resent. Events written best-effort — never break the queue.
- **Boot cleanup**: queued/draft/rendered posts at daemon start → `failed` (crash orphans).
- **Health**: `GET /health` (root, unauthed) — DB ping + queue liveness + stuck-run detection (running && idle >30min → 503).
- **RSS**: fail-safe (allSettled per feed, cache TTL 30min in `feeds_cache`). Total failure → null → pipeline falls back to non-news pillar. News pillar + no RSS + no non-news pillar → throw.

## Workflow for any change

1. Read the files you'll touch first. Understand before editing.
2. Typecheck: `cd apps/server && npx tsc --noEmit` (also web/shared/ui).
3. Tests: `npm test` from repo root (node:test, 43 tests). Pure logic → add unit test there.
4. New SQL → new migration `db/migrations/NNN_name.sql`, never edit applied ones.
5. 3+ files or API change → spawn verification agent before claiming done.
6. Commit style: `feat:/fix:/chore:` + short why-focused message.

## Commands

| Command | Where | Purpose |
|---|---|---|
| `npm run migrate` | apps/server | Apply pending migrations + seed admin |
| `npm run serve` | apps/server | Run daemon |
| `npm run daily -- --dry` | apps/server | One pipeline run, debug |
| `npm test` | root | All workspace tests |
| `npm run build` | apps/web | SPA → dist |

## Skills

Detailed per-domain guides live in `.agents/skills/<name>/SKILL.md`. Consult before working in that domain:

- `concepts` — architecture, data model, layer boundaries
- `state-management` — rotation state machine, slot resolution
- `feature` — vertical slice checklist (API + repo + FE)
- `pipeline` — generate flow, LLM steps, render, send
- `api-contract` — route table, error contract, zod pattern
- `testing` — test strategy, what goes where

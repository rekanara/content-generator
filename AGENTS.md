# AGENTS.md — content-generator operating brief

Source of truth: `SPEC.md` (v5). Quick brief for any AI agent working here — read SPEC.md for full detail, `.agents/skills/<name>/SKILL.md` for domain guides.

## What this is

Daemon (Mac mini) that auto-generates 1 developer-audience post/day per group (Indonesian language) for Instagram/LinkedIn. Output delivered to a Telegram chat; Jack uploads manually. NOT multi-agent, NOT auto-posting.

One process: Hono server + scheduler (`cron` package's `CronJob` — NOT node-cron) + Telegram bot (polling, no webhook) + in-process FIFO queue + pipeline (ideation → writer → critic → render → send).

## Monorepo layout (npm workspaces, Node ≥20)

- `apps/server` — daemon: Hono, postgres.js, tsx (no build step). Entry `src/server.ts`.
- `apps/web` — React 19 SPA (Vite). View-switcher state-based — no URL router, no react-query.
- `packages/shared` — zod v4, single FE↔BE contract. BE parses inputs; FE uses types only.
- `packages/ui` — tailwind v4 + shadcn-style components. Import: `@workspace/ui/components/<name>`.

## Hard rules (violations = broken protocol)

1. **Layering**: `api.ts` = transport only (zod parse, cookies, status codes) — ZERO raw SQL. `repos/` = SQL only — zero HTTP. `usecases/` = aggregation. Adapters (`llm.ts`, `tts.ts`, `telegram.ts`, `storage.ts`, `render/`) = external systems.
2. **All PKs UUID v7 strings.** `:id` route params guarded by UUID regex → 400.
3. **SQL always parameterized** via postgres.js tagged template. jsonb inserts: pass object or `${JSON.stringify(x)}::jsonb` — never bare JSON.stringify (double-encode bug, bit us once). NEVER build column lists with `sql('a, b')` — postgres.js treats it as a single quoted Identifier, not a fragment; inline columns literally (broke getRotation/listPosts silently until 2026-09-21).
4. **Zod-parse every input** at API boundary via `@workspace/shared`.
5. **State in Postgres.** Queue is in-process; `rotation_state` updated ONLY after post `sent` (spec AC #11 — failure mid-pipeline must not consume rotation).
6. **Secrets**: only read in `config.ts` (env) and `groups.ts` (DB override). Never to log/DB/report/commit.
7. **Pure functions** for testable logic: `state.ts` (zero imports), ffmpeg args, prompt builders, type guards, bot command parser, RSS freshness filter.
8. **`ponytail:` comment** marks deliberate simplification + upgrade path.
9. Max 1 LLM retry per step. No parallel reels render (CPU-bound, queue guarantees serial).
10. Group not visible to user → 404, not 403 (no existence leak).

## Key mechanics

- **Rotation** (`state.ts`, pure): platform alternates IG↔LinkedIn. Format alternates per platform: IG carousel↔reels, LinkedIn pdf↔text. Pillar round-robin by UUID v7 order (chronological). Missed days don't break pattern (state-based, not date parity).
- **Group config resolution** (`groups.ts` `toGroupCfg`): env = fallback, per-group DB columns override (llm_*, tts_*, telegram_*, cron_*, approval_required).
- **Queue** (`queue.ts`): FIFO, one active run. Cron/bot/FE/CLI all `enqueue()`. Deliver = render-if-needed → telegram send (withRetry 3×/5s) → markSent → post_events. Failure → markFailed + failed event + best-effort Telegram alert.
- **Approval gate** (per-group `approval_required`): generate → render → `awaiting_approval` → Telegram inline buttons + FE Posts tab → approve (queue job, deliver + rotation) | reject (instant, NO rotation). Send failure on approve → post STAYS awaiting (re-tap). `awaiting_approval` survives restarts (not boot-failed).
- **Rerender** (`/rerender [group]` bot, FE button, POST /posts/:id/rerender): same content re-rendered with the CURRENT template (no LLM). sent → restore status to `sent` + resend (rotation untouched); awaiting → awaiting + fresh buttons; rendered → gate on: awaiting + buttons, gate off: deliver (first send, rotation advances). Refuses failed/rejected/draft/queued and text format.
- **Watchdog** (`monitor.ts`): boot check + 6h heartbeat — missed cron slot (no post created since fire time) → Telegram alert. Alert-only, no auto-catchup. Fire-time math in `cronmath.ts` (`prevFire`/`nextFires`, pure-ish over `cron`'s CronTime).
- **Telegram polling gotcha**: `getUpdates` must pass `allowed_updates` explicitly — Telegram persists that filter per-bot across calls, and a stale `["message"]` (set by any previous consumer) silently drops ALL `callback_query` updates. Symptom: approval buttons "do nothing". Fixed 2026-09-21; keep the param.
- **Audit trail**: `post_events` table (migration 008/009), events: generated/rendered/awaiting_approval/approved/sent/failed/resent/rejected. Events written best-effort — never break the queue.
- **Boot cleanup**: queued/draft/rendered posts at daemon start → `failed` (crash orphans) + one alert per affected group. `awaiting_approval` is deliberate — survives.
- **Health**: `GET /health` (root, unauthed) — DB ping + queue liveness + stuck-run detection (running && idle >30min → 503).
- **RSS**: fail-safe (allSettled per feed, cache TTL 30min in `feeds_cache`). Total failure → null → pipeline falls back to non-news pillar. News pillar + no RSS + no non-news pillar → throw.
- **Calendar** (`usecases/calendar.ts`): N upcoming slots via pure `previewSlots` + cron fire dates. In-flight runs NOT reflected (rotation advances after `sent`).

## Workflow for any change

1. Read the files you'll touch first. Understand before editing.
2. Typecheck: `npm run typecheck` from root (turbo — covers server, web, shared, ui in one shot).
3. Tests: `npm test` from root (server unit tests only; node:test, 43 tests, zero-dep). Single file: from `apps/server`, `node --import tsx --test tests/state.test.ts`.
4. Lint: `npm run lint` from root — **currently red**: 2 pre-existing `react-refresh/only-export-components` errors in `packages/ui/src/components/{badge,button}.tsx` (shadcn cva export pattern). Not your fault; don't block on it. Server has no lint script.
5. New SQL → new migration `apps/server/db/migrations/NNN_name.sql`, never edit applied ones (001–009 applied).
6. 3+ files or API change → spawn verification agent before claiming done.
7. Commit style: `feat:/fix:/chore:` + short why-focused message.

## Commands

| Command | Where | Purpose |
|---|---|---|
| `npm run migrate` | root or apps/server | Apply pending migrations + seed admin (user `admin`, password from `CG_ADMIN_PASSWORD` env or random+printed, only if users table empty) |
| `npm run serve` | root or apps/server | Run daemon: API `:8787` + cron + bot + queue, serves built SPA |
| `npm run daily -- [--group slug] [--dry\|--no-render] [--platform X] [--format Y]` | apps/server | One pipeline run. `--no-render` = stop at draft. `--dry` = full render + MinIO upload but NO telegram send, NO rotation update |
| `npm run user:add -- <name> [--admin]` | apps/server | Create user (password via arg/stdin) |
| `npm run user:pass -- <name>` | apps/server | Reset password + revoke sessions |
| `npm run user:list` | apps/server | List users |
| `npm test` | root | Server unit tests |
| `npm run build` | apps/web | SPA → `apps/web/dist` |

Dev utilities in `apps/server/scripts/` (run via tsx): `reset-db.ts`, `check-db.ts`, `test-login.ts`, `test-rss.ts` (live feed check).

Setup: `cp .env.example apps/server/.env` — Postgres + MinIO + LLM + Telegram required (full list SPEC §10). NOTE: workspace scripts run with CWD `apps/server`, so the daemon reads `.env` from there, not repo root.

## Frontend gotchas

- **No Vite API proxy.** `api.ts` uses relative `fetch(path)` — the SPA only works same-origin against the daemon, which serves `apps/web/dist`. Standalone `npm run dev` (Vite :5173) will fail every API call. FE loop: `npm run build` (web) → `npm run serve`.
- SPA fallback: unknown non-`/api` route → `dist/index.html`; unknown `/api/*` → 404 JSON. Detail pages: `/app/:slug/templates/:id`, `/app/:slug/posts/:id` (content rendered inline — slides/video/PDF via `/api/g/:slug/posts/:id/artifacts/:file`, whitelist per format, session cookie rides on same-origin subresource loads).
- Add shadcn components from repo root: `npx shadcn@latest add <name> -c apps/web` (README says `pnpm dlx` — repo is npm). Components land in `packages/ui/src/components`.

## Skills

Detailed per-domain guides live in `.agents/skills/<name>/SKILL.md`. Consult before working in that domain:

- `concepts` — architecture, data model, layer boundaries
- `state-management` — rotation state machine, slot resolution
- `feature` — vertical slice checklist (API + repo + FE)
- `pipeline` — generate flow, LLM steps, render, send
- `api-contract` — route table, error contract, zod pattern
- `testing` — test strategy, what goes where

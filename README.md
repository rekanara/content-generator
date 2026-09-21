# content-generator

A daemon that auto-generates **one developer-audience post per day per group** (Indonesian language) — Instagram (carousel / voiceover reels) or LinkedIn (PDF / text), alternating automatically. Output is delivered to a Telegram chat for manual uploading. Not auto-posting, not multi-agent.

One process: HTTP API + admin SPA + per-group cron scheduler + Telegram bot (polling) + FIFO queue + pipeline (ideation → writer → critic → render → send).

Full detail: [SPEC.md](SPEC.md) · AI agent brief: [AGENTS.md](AGENTS.md)

## Key features

- **Automatic rotation** — platform alternates IG ↔ LinkedIn, format alternates per platform (carousel ↔ reels, PDF ↔ text), topic pillars round-robin. Missed days never break the pattern (state-based).
- **Multi-group, multi-user** — each group has its own config (LLM, TTS, Telegram, cron, pillars, templates) + session auth (admin / regular user).
- **Approval gate (optional, per group)** — posts pause at `awaiting_approval` before sending; approve/reject via inline buttons in Telegram or from the web.
- **Watchdog** — a missed cron slot (daemon down, run never started) triggers a Telegram alert at boot + every 6h heartbeat. Failed runs alert too — no silent failures.
- **Calendar preview** — see the next N slots (platform/format/pillar + schedule) without running the pipeline.
- **Audit trail** — every post event is recorded (`post_events`).
- Fresh tech-news content from RSS (Hacker News, dev.to) with a safe fallback when feeds die.

## Requirements

- Node ≥ 20
- PostgreSQL 16+
- MinIO (PNG/PDF/MP4 artifacts)
- An LLM API (OpenAI-compatible — any base URL + key, e.g. OpenRouter)
- Telegram bot token + chat ID

## Setup

```bash
npm install

# env is read from the CWD apps/server (npm workspace scripts run there)
cp .env.example apps/server/.env
# fill in: DB_*, MINIO_*, LLM_*, TELEGRAM_* — see the file for the full list

# apply SQL migrations + seed the admin user
npm run migrate
```

Admin seeding only runs when the `users` table is empty. Username `admin`, password from the `CG_ADMIN_PASSWORD` env var — if unset, a random one is generated and **printed once** to the console during migrate.

MinIO: default bucket `content-generator` (create it manually or via the MinIO console).

## Running

```bash
# build the SPA first (the daemon serves apps/web/dist — required before serve)
npm run build            # from repo root (turbo) or in apps/web

# run the daemon (API :8787 + cron + bot polling + queue)
npm run serve
```

Open `http://localhost:8787` → log in → admin SPA.

Frontend note: **there is no Vite dev proxy.** `npm run dev` (Vite :5173) will fail every API call — the FE dev loop is `npm run build` (web) → refresh the page. Daemon health check: `GET /health` (unauthenticated).

## Everyday commands

| Command | Purpose |
|---|---|
| `npm run migrate` | Apply pending SQL migrations + seed admin |
| `npm run serve` | Run the daemon |
| `npm test` | Unit tests (server, zero-dep `node:test`) |
| `npm run typecheck` | Typecheck all workspaces (turbo) |
| `npm run lint` | Lint (web + ui; 2 pre-existing errors in packages/ui, shadcn pattern) |

CLI in `apps/server`:

| Command | Purpose |
|---|---|
| `npm run daily -- [--group slug] [--dry\|--no-render] [--platform X] [--format Y]` | One pipeline run. `--no-render` stops at draft; `--dry` renders + uploads to MinIO but does **not** send to Telegram and does not advance rotation |
| `npm run user:add -- <name> [--admin]` | Create a user (password via arg/stdin) |
| `npm run user:pass -- <name>` | Reset password + revoke all sessions |
| `npm run user:list` | List users |

## Telegram bot

Talk to the bot directly (global env token). Polling-based — no public URL or webhook needed.

```
/gen [group] [platform] [format]   — manual generate (no args = first group, natural rotation)
/status [group]                    — schedule, rotation position, latest post
/help                              — help
```

When a group enables the approval gate, generated posts arrive with **Approve / Reject** buttons — approve = send now + advance rotation, reject = discard without consuming the slot's rotation.

## Structure

```
apps/server        daemon — Hono API, postgres.js, cron, bot, queue, pipeline, render (Puppeteer + ffmpeg)
apps/web           admin SPA — React 19 + Vite (state-based view switcher, no URL router)
packages/shared    single FE↔BE contract (zod v4)
packages/ui        components (tailwind v4 + shadcn-style)
```

Strict architecture rules (layering, parameterized SQL, zod at boundaries, UUID v7 PKs) — read [AGENTS.md](AGENTS.md) before contributing.

Adding shadcn components (from repo root — this repo uses npm, not pnpm):

```bash
npx shadcn@latest add <name> -c apps/web
```

Components land in `packages/ui/src/components`, imported as `@workspace/ui/components/<name>`.

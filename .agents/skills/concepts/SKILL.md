# Skill: concepts — architecture & data model

When to use: any change touching structure, new table, new module, or when unsure where code belongs.

## The one-liner

Daemon: Hono server + node-cron + Telegram polling bot + in-process FIFO queue + pipeline (ideation → writer → critic → render → send). Single process on Mac mini. Output → Telegram chat, Jack uploads manually to IG/LinkedIn. No auto-posting. No multi-agent.

## Monorepo

- `apps/server` — daemon. tsx, no build step. TypeScript strict ESM.
- `apps/web` — React 19 + Vite SPA. View-switcher state-based (no URL router — decision #9).
- `packages/shared` — zod v4 schemas: single FE↔BE contract. BE parses, FE is type-only.
- `packages/ui` — tailwind v4 + shadcn-style.

## Layer rules (the load-bearing wall)

```
api.ts          transport: zod parse, cookies, status codes — ZERO SQL
auth/           password (scrypt) | session | rate-limit | users
db/             pool.ts (postgres.js), migrate.ts (runner + admin seed)
repos/          SQL only, zero HTTP — pillars, posts, events, styles, templates, rotation
usecases/       aggregation (dashboard)
groups.ts       group repo + config resolution (env fallback → DB override)
state.ts        PURE rotation logic — zero imports
adapters:       llm.ts, tts.ts, telegram.ts, storage.ts (MinIO), render/*
```

Adapters know nothing about API. Repos know nothing about HTTP. If you write `sql` in api.ts or `fetch` in repos — wrong layer, move it.

## Data model (PostgreSQL, migrations 001–008)

```
groups          id, slug, name, user_id (owner, null=admin), cron_expr, cron_enabled,
                llm_* / tts_* / telegram_* overrides, created_at
users           id, username unique, password_hash (scrypt), role (admin|user)
sessions        id, user_id, token_hash (sha256), expires_at (sliding 30d)
pillars         id, group_id, name, description, is_news, active, sort_order
rotation_state  group_id PK, last_platform, last_ig_format, last_li_format, last_pillar_id
posts           id, group_id, platform, format, pillar_id, topic, caption, body jsonb,
                artifact_prefix, status (queued|draft|rendered|sent|failed), error, source, llm_usage
post_events     id, post_id, group_id, event (generated|rendered|sent|failed|resent), error, created_at
templates       id, group_id?, name, format (ig-carousel|li-carousel|reel), html, is_active
style_samples   id, group_id, title, body, platform
feeds_cache     url PK, fetched_at, items jsonb
```

All PKs UUID v7 (time-ordered strings in TS). Slug reserved: `users`, `login`.

## Multi-group model

Group = one "content account" with own LLM/TTS/Telegram/cron/pillars/rotation. Admin sees all; user sees own groups (`user_id`). Group invisible to user → 404 (never 403 — no existence leak). First group = default at login.

## Key invariants

- Rotation advances only on `sent` (AC #11).
- One active queue run per daemon.
- Boot: orphan queued/draft/rendered → failed.
- Secrets only in config.ts (env) + groups.ts (DB). Never logged.
- Migrations are append-only. New change → new `NNN_*.sql`.

## Config resolution

Env (`config.ts`) = fallback. Group DB columns override via `toGroupCfg` (groups.ts). LLM creds validated at generate time, not boot.

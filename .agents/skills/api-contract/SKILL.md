# Skill: api-contract — routes, auth, zod pattern

When to use: adding/changing any `/api/*` route, auth behavior, or shared schema.

## Auth model

- Session cookie `cg_session`: httpOnly, sameSite Strict, path /api, secure in prod, sliding 30d.
- Token: random → sha256 hash in `sessions` table. Cookie holds raw token.
- Login rate-limit: 5 fails / 15 min per IP → lock 15 min. Anti-enumeration: same error for bad user vs bad password.
- Scrypt password hashing (`auth/password.ts`).
- Admin guard: user management + group CRUD. Group visibility: admin = all, user = own (`user_id`).
- Middleware (`api.ts`): every `/api/*` requires session except `/auth/login`. Sliding re-set on each request.

## Route table (current)

| Method | Route | Notes |
|---|---|---|
| POST | /api/auth/login | rate-limited, sets cookie |
| POST | /api/auth/logout | destroys session |
| GET | /api/auth/me | user + visible groups |
| POST/GET | /api/users | admin: create / list |
| POST | /api/users/:id/password | self or admin, revokes sessions |
| DELETE | /api/users/:id | admin, last-admin guard |
| GET/POST | /api/groups | list (scoped) / create (admin) |
| PATCH/DELETE | /api/groups/:slug | admin + owner check |
| GET | /api/g/:slug/dashboard | cron + queue + rotation + next_slot + last 10 posts |
| GET/POST | /api/g/:slug/pillars | + PATCH-ish toggle `:id/toggle`, DELETE `:id` |
| GET/POST | /api/g/:slug/cron | status / save expr+enabled (re-schedules) |
| GET | /api/g/:slug/posts | list |
| GET | /api/g/:slug/posts/:id | detail |
| GET | /api/g/:slug/posts/:id/events | audit trail (desc, 50) |
| POST | /api/g/:slug/posts/:id/resend | enqueue → 202 |
| POST | /api/g/:slug/gen | manual generate → 202 |
| GET/POST/DELETE | /api/g/:slug/styles[/:id] | CRUD |
| GET/POST/DELETE | /api/g/:slug/templates[/:id] | + POST `:id/activate` |
| GET | /health | ROOT not /api — unauthed, DB ping + queue liveness |

## The zod pattern (every input)

```ts
import { XInput } from '@workspace/shared';
const parsed = XInput.safeParse(await c.req.json().catch(() => null));
if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400);
```

- Schemas live in `packages/shared` — NEVER inline zod in api.ts for request bodies (LoginBody/UserInput/PassInput are legacy inline; new ones go to shared).
- `:id` params: `isUuid(id)` regex → 400. No integer IDs anywhere.
- Group resolution: `gr(c)` helper — 404 when slug unknown or invisible.

## Response contract

- Success: resource JSON directly, or `{ok: true}` / `{ok: true, queued: queueStatus()}` for actions.
- Async (gen, resend): 202 + queue status, work happens in queue.
- Errors: 400 `{error, issues?}` | 401 `{error}` | 404 `{error}` | 429 (login lock) | 500 Hono default.
- Group invisible → 404. NEVER 403 (no existence leak).

## SPA + static (server.ts)

- `/api/*` unknown → 404 JSON.
- `/*` → serveStatic `apps/web/dist` + index.html fallback (client view-switcher).
- `/health` → root-level unauthed (launchd/pm2 probe). DB ping via sql`select 1` — allowed here, this is server.ts not api.ts.

## When adding a route

1. Schema to shared (input + types).
2. Repo fn (SQL, group-scoped).
3. Route in api.ts: parse → repo → json. Zero SQL in route.
4. UUID guard on every `:id`.
5. FE client fn in `apps/web/src/lib/api.ts` + hook.

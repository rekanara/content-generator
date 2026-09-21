# Skill: feature — vertical slice checklist

When to use: adding any new feature/capability that spans BE + FE (new resource, new endpoint, new UI view).

## The slice

Every feature touches these layers IN ORDER. Skipping a layer = broken contract.

1. **Migration** (if new table/column): `apps/server/db/migrations/NNN_name.sql`. Append-only, never edit applied ones. FKs with `on delete cascade` where child rows must die with parent.
2. **Shared contract**: zod schema in `packages/shared/src/index.ts`. Input schemas (`XInput`) for API bodies. Export types alongside.
3. **Repo**: `apps/server/src/repos/<name>.ts`. SQL only. Group-scoped: every query filters `group_id = ${groupId}`. Parameterized tagged templates always.
4. **API route**: `apps/server/src/api.ts` (or sub-router). Zod-parse body → 400 `{error, issues?}` on fail. UUID-guard `:id` params. Return repo result as JSON. ZERO raw SQL here.
5. **Auth scope**: route under `g` (group router) → auto group-visibility via `gr(c)`. Admin-only → explicit role check. Invisible resource → 404.
6. **FE hook** (if UI): `apps/web/src/lib/api.ts` typed fetch client → `hooks.ts` useEffect hook.
7. **FE view**: `apps/web/src/views/<name>.tsx`. Function components, `@workspace/ui` components, lucide-react icons. Wire into view-switcher (App state, not URL).
8. **Test**: pure logic → `apps/server/tests/`. Repo/API → manual verify via curl + `npm run serve`.

## Route conventions

- Group-scoped: `GET/POST /api/g/:slug/<resource>`, `PATCH/DELETE .../:id`, POST `.../:id/<action>` (resend, activate, toggle, gen).
- Global: `/api/login|logout|me|users|groups|health`.
- `:id` guard: `isUuid()` regex → 400.
- Async work (generate, resend): enqueue → `202 {ok, queued}` immediately.

## Error contract

- 400 zod fail: `{error: 'invalid input', issues: [...]}` 
- 401: unauthenticated (`{error: 'not logged in'}`)
- 404: unknown resource OR group invisible to user (`{error}`) — never 403 for group scoping
- 429: rate limit (login)
- 500: Hono default

## Checklist before claiming done

```
[ ] migration idempotent (re-run no-op)
[ ] zod input schema in shared, used by api.ts
[ ] repo group-scoped, parameterized
[ ] api route: zero SQL, UUID guards
[ ] FE: api.ts client fn + hook + view wired
[ ] cd apps/server && npx tsc --noEmit — clean
[ ] npm test (root) — all pass, new test if pure logic
[ ] 3+ files changed → verification agent before final claim
```

## Anti-patterns (seen and rejected)

- SQL string in api.ts — layer break.
- New dependency for what 5 stdlib lines do — ask first (SPEC boundaries).
- URL router in FE — decision #9 locked state-based.
- JSON.stringify into jsonb param without `::jsonb` — double-encode bug (happened in rss.ts; fixed with cast + tolerant read).
- Incrementing mutation of rotation_state from anywhere but commitSent.

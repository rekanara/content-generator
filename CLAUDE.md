# CLAUDE.md

Read `AGENTS.md` first — it is the operating brief for this repo (hard rules, layering, workflow).

Full spec: `SPEC.md`. Domain guides: `.agents/skills/<name>/SKILL.md`.

Quick orientation:

- Monorepo: `apps/server` (daemon), `apps/web` (React SPA), `packages/shared` (zod contract), `packages/ui`.
- Server: TypeScript strict ESM, tsx (no build), postgres.js tagged templates, Hono. All PKs UUID v7 strings.
- api.ts = zero SQL. repos/ = SQL only. Pure logic in `state.ts` etc. — unit-test those.
- Verify before claiming: `cd apps/server && npx tsc --noEmit` + `npm test` (root).

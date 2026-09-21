# Skill: testing — strategy & conventions

When to use: writing or changing tests, or deciding whether new logic needs a test.

## Runner

`node:test` (zero dep). Run: `npm test` (root, all workspaces). Server tests in `apps/server/tests/*.test.ts`, executed via tsx.

## What's tested (current: 43, all passing)

| Suite | Covers |
|---|---|
| state.test.ts (13) | rotation: platform flip, format alternation, pillar round-robin, forced slots, nextState |
| bot.test.ts (5) | command parser (/gen, /status, args) |
| ffmpeg.test.ts (7) | arg builders — pure |
| auth/password.test.ts (4) | scrypt hash round-trip |
| posts/flattenBody (4) | body flattening for UI |
| rss.test.ts (5) | pickFresh: stale filter, dedup, cap 8, formatContext |
| shared | zod contract schemas |

## The rule

**Pure logic gets unit tests. Side-effectful code gets manual verification.**

Pure (must test): state.ts, ffmpeg args, prompt builders, type guards, bot parser, zod schemas, RSS filter, flattenBody.

Manual (curl + serve): API routes, repos, pipeline E2E, render, telegram. LLM quality = human review, never mocked.

## Adding a test

```ts
// apps/server/tests/<name>.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSlot } from '../src/state.ts';

test('platform flips', () => {
  assert.equal(nextSlot({ last_platform: 'instagram', ... }, pillars, true).platform, 'linkedin');
});
```

- assert/strict. No mocking framework — if you need mocks, the logic isn't pure enough.
- New pure logic + no test = incomplete change.
- Tests encode CONTRACT — behavior change means test changes first (TDD for state.ts).

## Integration checklist (manual, when touching pipeline/API)

```
cd apps/server
npm run migrate          # idempotent — schema current
npm run serve            # daemon up
curl localhost:8787/health           # {ok:true, db:true, queue:{...}}
curl -X POST localhost:8787/api/auth/login -d '{...}' -c jar
curl -b jar localhost:8787/api/g/<slug>/dashboard
scripts/test-rss.ts      # live RSS smoke
```

## Pre-claim verification (every change)

```
cd apps/server && npx tsc --noEmit   # clean
npm test                             # 43+ pass, 0 fail
```

3+ files or API change → verification agent BEFORE claiming done. This caught the jsonb double-encode bug and dead-script imports — it works, use it.

## Anti-patterns

- Mocking postgres/LLM/puppeteer in unit tests — not the model.
- Testing private fns — test the exported contract.
- Snapshot tests of prompts — brittle, review the diff instead.

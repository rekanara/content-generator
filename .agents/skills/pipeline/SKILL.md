# Skill: pipeline — generate flow, render, deliver

When to use: touching `pipeline.ts`, `queue.ts`, `render/`, `llm.ts`, `tts.ts`, `telegram.ts`, RSS, or cron.

## One run (the full chain)

```
enqueue(job) → queue FIFO (one active run per daemon)
  → getGroupCfg(slug)                # env fallback + DB override (groups.ts)
  → resolveSlot(groupId, forced?)    # state.ts pure logic + repos/rotation
  → generateDraft(cfg, slot, source) # pipeline.ts:
        pillar fetch → (news? RSS context | fallback non-news pillar)
        → ideation  (writer model, ideationPrompt, isIdeationOut guard, 30-topic dedup history)
        → writer    (writerPrompt + 8 style samples, writerGuard(format))
        → critic    (SEPARATE model — criticModel(cfg), same guard)
        → insert post (status draft, llm_usage accumulated)
  → addEvent('generated')
  → deliver(cfg, postId, slot, notify):
        post.status !== 'rendered':
          text     → send body directly (no render) → markSent → addEvent('sent')
          reels    → renderReelsAndSave (TTS per scene + ffmpeg concat)
          carousel → renderAndSave (Puppeteer PNG/PDF per template)
          → addEvent('rendered')
        → telegram send withRetry(3 tries, 5s delay):
            carousel: sendMediaGroupPhoto (≤10 slides)
            pdf:      sendDocument
            reels:    sendVideo (supports_streaming)
        → markSent → addEvent('sent')
```

Failure at ANY step after generateDraft: `markFailed` (status → failed) + addEvent('failed'), rethrow. Rotation NOT consumed (commitSent never ran).

## LLM contract (`llm.ts`)

- OpenAI-compatible chat → JSON. `chatJson(cfg, model, prompt, guard, maxTokens)`.
- Output validated by type guard (`schema.ts`) — LLM output is UNTRUSTED input. Invalid JSON → 1 retry → throw (max 1, never infinite).
- AbortSignal.timeout(300s). Usage tokens accumulated per step into `posts.llm_usage`.
- Critic model: `LLM_MODEL_CRITIC` or group override; empty → same as writer.
- Style samples (8 latest, platform-matching) injected into writer + critic prompts always (decision #7).

## Render

- `render/carousel.ts` — Puppeteer, HTML template → PNG slides (1080×1350) or PDF. Template from `templates` table (is_active per format per group) via `render/template.ts`.
- `render/reels.ts` — scene-based: writer output 4–6 scenes `{overlay_text, narration}` → TTS per scene (`tts.ts`, msedge-tts id-ID default) → ffprobe duration → PNG frame per scene → ffmpeg segments → concat → MP4 1080×1920, 15–30s, no music.
- `render/ffmpeg.ts` — PURE arg builders, unit-tested. Keep it that way.
- NEVER render reels in parallel — CPU-bound, queue serializes (SPEC never-list).
- Artifacts → MinIO (`storage.ts`), key prefix `posts/<id>/` (`artifact_prefix`).

## Telegram

- Streaming from MinIO → buffer → Blob. Photos ≤10 per album, caption ≤1024 (first photo).
- All sends wrapped in `withRetry` (queue.ts): 3 tries, 5s fixed backoff. Fixed not exponential — `ponytail:` ceiling.
- Bot polling (getUpdates, env token — global, not per-group). Commands: `/gen [group] [platform] [format]`, `/status [group]`. Command parser is pure + tested.

## RSS (fail-safe by design)

- 4 feeds, `Promise.allSettled` — one dead feed never kills the run.
- `feeds_cache` TTL 30min. jsonb insert: `${JSON.stringify(items)}::jsonb` + tolerant read (legacy double-encoded rows).
- Total failure → null → news pillar falls back to non-news. No non-news → throw.
- Fresh window: 48h, dedup case-insensitive, top 8.

## Cron

- node-cron per group, `Asia/Jakarta`, from `groups.cron_expr`. Re-scheduled on PATCH via `refreshCron`. `cronStatus(groupId)` for dashboard.

## Queue liveness & health

- `lastActivity` touched on enqueue + job start/finish. `queueLiveness()` → {running, pending, lastActivityMs}.
- `GET /health` (root, unauthed): DB ping + stuck detection (running && idle >30min → 503).
- Boot: orphans (queued/draft/rendered) → failed + 'orphaned at boot' event.

## post_events audit (migration 008)

Event kinds: `generated | rendered | sent | failed | resent`. Written best-effort — addEvent failure NEVER breaks the queue. API: `GET /api/g/:slug/posts/:id/events`.

// Live progress for the single active queue run. The queue is strictly serial
// (one job at a time), so ONE in-memory slot is the whole truth. This is the
// "what is happening RIGHT NOW" view for /api/queue/live — history stays in
// post_events (coarse), this is fine-grained pipeline telemetry.
// No run active (e.g. direct CLI use of generateDraft) → every setter is a no-op.
export type RunStage =
  | 'slot' | 'ideation' | 'writer' | 'critic' | 'render' | 'deliver'
  | 'awaiting' | 'done' | 'failed';

export type RunProgress = {
  active: boolean;
  kind: string;         // queue job kind: generate | approve | rerender | ...
  slug: string;
  postId: string | null; // known once the draft persists (generate runs)
  stage: RunStage;
  detail: string | null; // topic / critic score / error message
  startedAt: number;
  updatedAt: number;
  error: string | null;
};

let current: RunProgress | null = null;

export function startRun(kind: string, slug: string): void {
  current = {
    active: true, kind, slug, postId: null, stage: 'slot', detail: null,
    startedAt: Date.now(), updatedAt: Date.now(), error: null,
  };
}

export function stage(s: RunStage, detail: string | null = null): void {
  if (!current?.active) return; // no active run (CLI path, or already ended) — ended runs keep their final state
  current.stage = s;
  current.detail = detail;
  current.updatedAt = Date.now();
}

export function postRef(postId: string): void {
  if (!current?.active) return;
  current.postId = postId;
  current.updatedAt = Date.now();
}

// Terminal. Error → failed. Success keeps an explicit 'awaiting' pause, else 'done'.
// Idempotent guard: an ended run keeps its final state — a second endRun (or one
// racing a stray setter) must never rewrite it.
export function endRun(error?: string): void {
  if (!current?.active) return;
  current.active = false;
  if (error) {
    current.stage = 'failed';
    current.error = error.slice(0, 300);
  } else if (current.stage !== 'awaiting') {
    current.stage = 'done';
  }
  current.updatedAt = Date.now();
}

// Snapshot copy — callers must never mutate the live slot.
export function readRun(): RunProgress | null {
  return current ? { ...current } : null;
}

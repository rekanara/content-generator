-- Idea backlog: user-submitted topics consumed by the pipeline in FIFO order.
-- An idea row is the TOPIC for a run — ideation LLM is skipped (saves a call and
-- keeps the human in the loop). used_at marks consumption AFTER the draft persists
-- (a failed run does not burn the idea — it simply gets re-attempted next time).
create table if not exists ideas (
  id uuid primary key default uuidv7(),
  group_id uuid not null references groups(id) on delete cascade,
  text text not null check (length(text) between 3 and 400),
  source text not null default 'bot' check (source in ('bot', 'fe')),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ideas_unused_idx on ideas (group_id, created_at) where used_at is null;

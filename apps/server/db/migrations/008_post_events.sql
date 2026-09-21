-- 008: post_events — audit trail per post (what happened, when, why failed, token usage).
create table post_events (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  event text not null check (event in ('generated','rendered','sent','failed','resent')),
  error text,
  created_at timestamptz not null default now()
);
create index post_events_post_idx on post_events (post_id, created_at desc);
create index post_events_group_idx on post_events (group_id, created_at desc);

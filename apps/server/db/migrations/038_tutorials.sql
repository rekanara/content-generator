create table tutorials (
  id uuid primary key default uuidv7(),
  group_id uuid not null references groups(id) on delete cascade,
  topic text not null,
  level text not null default 'beginner' check (level in ('beginner', 'intermediate')),
  language text not null default 'id',
  source_urls text[] not null,
  source_snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'queued', 'generated', 'failed')),
  post_id uuid references posts(id) on delete set null,
  template_id uuid references templates(id) on delete set null,
  template_reel_id uuid references templates(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(source_urls) > 0)
);

alter table posts add column tutorial_id uuid references tutorials(id) on delete set null;

create index tutorials_group_created_idx on tutorials (group_id, created_at desc);
create index tutorials_post_idx on tutorials (post_id);
create index posts_tutorial_idx on posts (tutorial_id);

alter table llm_runs drop constraint llm_runs_kind_check;
alter table llm_runs add constraint llm_runs_kind_check
  check (kind in ('planner', 'news_score', 'news_autofill', 'promo', 'polish', 'failed_run', 'pillars', 'styles', 'tutorial'));

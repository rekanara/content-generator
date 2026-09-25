-- 018: usage tracking — planner runs (post runs already carry llm_usage jsonb).
-- llm_runs: every LLM invocation OUTSIDE a post (planner today; cover gen is attached
-- to the post row's usage). Costs snapshotted at run time (llm-costs.ts catalog).
-- (no begin/commit — the migrate runner wraps each file in a transaction)

create table llm_runs (
  id uuid primary key default uuidv7(),
  group_id uuid references groups(id) on delete cascade,
  kind text not null check (kind in ('planner')),
  model text not null,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  cost numeric(10,4) not null default 0,   -- USD, snapshot
  created_at timestamptz not null default now()
);
create index llm_runs_group_idx on llm_runs (group_id, created_at desc);

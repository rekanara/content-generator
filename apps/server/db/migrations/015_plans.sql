-- 015: plans — the date-scoped source of truth for WHAT runs on a given day.
-- Model: plans are EXCEPTIONS, not a schedule — absence of a plan means natural
-- rotation (state-based, self-healing; pre-computed schedules would drift).
--   slot_override    : the date's pipeline run uses THIS platform/format/pillar/template
--                      (e.g. "github repo recommendations" pinned to an image_only template)
--   override_content : the date belongs to an override row (created automatically by
--                      the override flow — manual content replaces the pipeline)
-- (no begin/commit — the migrate runner wraps each file in a transaction)

create table plans (
  id uuid primary key default uuidv7(),
  group_id uuid not null references groups(id) on delete cascade,
  for_date date not null,
  type text not null check (type in ('slot_override','override_content')),
  -- slot_override spec (all nullable → falls back to natural rotation per field)
  platform text check (platform in ('instagram','linkedin')),
  format text check (format in ('carousel','reels','pdf','text')),
  pillar_id uuid references pillars(id) on delete set null,
  template_id uuid references templates(id) on delete set null,
  -- override_content link (the override row owns the content)
  override_id uuid references overrides(id) on delete cascade,
  note text not null default '',
  status text not null default 'active' check (status in ('active','cancelled')),
  created_at timestamptz not null default now()
);

-- one active plan per (group, date) — cancelled frees the date (same pattern as overrides)
create unique index plans_group_date on plans (group_id, for_date) where status <> 'cancelled';
create index plans_group_status on plans (group_id, status, for_date);
create index plans_override on plans (override_id);

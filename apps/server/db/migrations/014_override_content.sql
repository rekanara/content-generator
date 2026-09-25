-- 014: override content — manual content that replaces the automatic pipeline
-- for a specific date (group-scoped). Plus templates.type so override forms can
-- filter matching templates.
-- (no begin/commit — the migrate runner wraps each file in a transaction)

-- template role: 'regular' = pipeline rendering (existing behavior, default),
-- 'mix' | 'image_only' | 'text_only' = designed for override content of that type.
-- Immutable after create (like format); one active per format still governs rendering.
alter table templates add column type text not null default 'regular'
  check (type in ('regular','mix','image_only','text_only'));

create table overrides (
  id uuid primary key default uuidv7(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  -- mix: exactly 1 image + description; image_only: 1..10 images (+caption);
  -- text_only: description only, no images
  type text not null check (type in ('mix','image_only','text_only')),
  template_id uuid references templates(id) on delete set null,
  description text not null default '',
  for_date date not null,                       -- slot date (Asia/Jakarta) this override owns
  images jsonb not null default '[]'::jsonb,    -- artifact file names, stored in MinIO overrides/<id>/
  status text not null default 'scheduled' check (status in ('scheduled','sent','cancelled')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- one OVERRIDE per (group, date) while not cancelled — a cancelled override frees the
-- date for re-creation (or normal generation).
create unique index overrides_group_date on overrides (group_id, for_date)
  where status <> 'cancelled';
create index overrides_group_status on overrides (group_id, status, for_date);

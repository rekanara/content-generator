-- 001_init: schema inti content-generator — semua PK uuid v7 (time-ordered).
-- PG16: belum ada uuidv7 native → fungsi SQL (naikkan ke PG18 uuidv7() builtin saat upgrade).

create or replace function uuidv7() returns uuid as $$
declare
  ts bigint;
  b bytea;
begin
  ts := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  b := uuid_send(gen_random_uuid());
  b := overlay(b placing substring(int8send(ts) from 3) from 1 for 6); -- 48-bit unix ms
  b := set_byte(b, 6, (get_byte(b, 6) & 0x0f) | 0x70);                -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 0x3f) | 0x80);                -- variant 10xx
  return encode(b, 'hex')::uuid;
end
$$ language plpgsql volatile;

create table settings (
  id boolean primary key default true check (id),
  cron_expr text not null default '0 7 * * *',
  cron_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into settings (id) values (true) on conflict (id) do nothing;

create table pillars (
  id uuid primary key default uuidv7(),
  name text not null unique,
  description text not null,
  is_news boolean not null default false,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table rotation_state (
  id boolean primary key default true check (id),
  last_platform text not null check (last_platform in ('instagram','linkedin')),
  last_ig_format text check (last_ig_format in ('carousel','reels')),
  last_li_format text check (last_li_format in ('text','pdf')),
  last_pillar_id uuid references pillars(id),
  updated_at timestamptz not null default now()
);

create table posts (
  id uuid primary key default uuidv7(),
  created_at timestamptz not null default now(),
  platform text not null check (platform in ('instagram','linkedin')),
  format text not null check (format in ('carousel','reels','pdf','text')),
  pillar_id uuid references pillars(id),
  topic text not null default '',
  caption text not null default '',
  body text,
  artifact_prefix text,
  status text not null default 'queued'
        check (status in ('queued','draft','rendered','sent','failed')),
  error text,
  source text not null default 'cron' check (source in ('cron','telegram','web','cli')),
  llm_usage jsonb
);
create index posts_created_idx on posts (created_at desc);

create table templates (
  id uuid primary key default uuidv7(),
  name text not null,
  format text not null check (format in ('ig-carousel','li-carousel','reel')),
  html text not null,
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);

create table style_samples (
  id uuid primary key default uuidv7(),
  title text not null,
  body text not null,
  platform text check (platform in ('instagram','linkedin')),
  created_at timestamptz not null default now()
);

create table feeds_cache (
  url text primary key,
  fetched_at timestamptz not null,
  items jsonb not null
);

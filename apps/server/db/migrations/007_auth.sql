-- 007: multi-user auth — users (scrypt hash) + sessions (token sha256) + groups.user_id ownership.
begin;

create table users (
  id uuid primary key default uuidv7(),
  username text not null unique,
  password_hash text not null,           -- format: scrypt$N$r$p$salt_hex$hash_hex
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default uuidv7(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,       -- sha256(token) — DB leak ≠ session stolen
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);
create index sessions_user_idx on sessions (user_id);

-- ownership: each group belongs to one user. existing groups → first admin (seeded via CLI).
alter table groups add column user_id uuid references users(id) on delete cascade;

commit;

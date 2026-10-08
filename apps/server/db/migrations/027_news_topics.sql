create table news_topics (
  id uuid primary key default uuidv7(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (group_id, name)
);

create table news_sources (
  id uuid primary key default uuidv7(),
  topic_id uuid not null references news_topics(id) on delete cascade,
  name text not null,
  url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (topic_id, url)
);

create table news_rules (
  topic_id uuid primary key references news_topics(id) on delete cascade,
  freshness_hours int not null default 72 check (freshness_hours > 0),
  min_sources int not null default 1 check (min_sources > 0),
  allowed_domains text[] not null default '{}',
  blocked_domains text[] not null default '{}',
  keywords text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index news_topics_group_idx on news_topics (group_id, active, created_at desc);
create index news_sources_topic_idx on news_sources (topic_id, active, created_at desc);

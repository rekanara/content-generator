create table news_items (
  id uuid primary key default uuidv7(),
  topic_id uuid not null references news_topics(id) on delete cascade,
  source_id uuid references news_sources(id) on delete set null,
  title text not null,
  url text not null,
  domain text not null,
  summary text not null default '',
  published_at timestamptz,
  status text not null default 'pending' check (status in ('pending','valid','rejected','used')),
  score int check (score between 0 and 100),
  reason text,
  created_at timestamptz not null default now(),
  unique (topic_id, url)
);

create index news_items_topic_status_idx on news_items (topic_id, status, published_at desc nulls last, created_at desc);
create index news_items_domain_idx on news_items (domain);

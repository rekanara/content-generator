-- Extra source URLs for a news item fetched via "Fetch article(s)" with more than one link.
-- news_items keeps the PRIMARY url/title/domain (used for dedup, claim, source line);
-- additional corroborating sources live here so research can combine multiple articles.
create table news_item_sources (
  id uuid primary key default uuidv7(),
  item_id uuid not null references news_items(id) on delete cascade,
  url text not null,
  domain text not null,
  title text not null default '',
  created_at timestamptz not null default now(),
  unique (item_id, url)
);

create index news_item_sources_item_idx on news_item_sources (item_id);

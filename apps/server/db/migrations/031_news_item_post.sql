alter table news_items add column post_id uuid references posts(id) on delete set null;

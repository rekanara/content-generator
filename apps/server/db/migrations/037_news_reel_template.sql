alter table news_topics add column template_reel_id uuid references templates(id) on delete set null;

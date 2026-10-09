alter table news_topics add column use_source_images boolean not null default false;
alter table posts add column photo_credit text;

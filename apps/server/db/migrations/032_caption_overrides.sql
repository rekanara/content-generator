-- 032: per-item caption CTA/footer overrides. NULL/blank = fall back to the group
-- setting (groups.caption_cta / groups.caption_footer).
alter table news_topics add column caption_cta text, add column caption_footer text;
alter table overrides add column caption_cta text, add column caption_footer text;
alter table promotions add column caption_cta text, add column caption_footer text;

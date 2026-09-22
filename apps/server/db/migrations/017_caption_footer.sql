-- 017: caption maximization — structured captions (title/subtitle/cta/tags from the
-- writer LLM) + per-group caption footer (settings; NULL/'' = not shown).
-- The assembled final caption is stored in posts.caption at generate time.
-- (no begin/commit — the migrate runner wraps each file in a transaction)

alter table groups add column caption_footer text;

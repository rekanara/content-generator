-- 019: per-group CTA override — replaces the LLM-generated cta line in assembled
-- captions when set (NULL/'' = use the LLM's cta). Same pattern as caption_footer.
-- (no begin/commit — the migrate runner wraps each file in a transaction)

alter table groups add column caption_cta text;

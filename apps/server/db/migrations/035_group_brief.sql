-- 035: group brief — the owner's free-text story of the account (audience, intent,
-- voice). Context for AI pillar suggestions. Also records that LLM spend.
alter table groups add column brief text;

alter table llm_runs drop constraint llm_runs_kind_check;
alter table llm_runs add constraint llm_runs_kind_check
  check (kind in ('planner', 'news_score', 'news_autofill', 'promo', 'polish', 'failed_run', 'pillars'));

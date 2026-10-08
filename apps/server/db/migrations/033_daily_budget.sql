-- 033: per-group daily LLM budget (USD, Asia/Jakarta day). NULL = unlimited.
-- Also widens llm_runs.kind: every LLM call outside a post (news scoring, autofill,
-- promo writing, override polish, tokens of generate runs that failed before the
-- post row existed) is now recorded, so the budget sees all spend.
alter table groups add column daily_budget numeric(10,4);

alter table llm_runs drop constraint llm_runs_kind_check;
alter table llm_runs add constraint llm_runs_kind_check
  check (kind in ('planner', 'news_score', 'news_autofill', 'promo', 'polish', 'failed_run'));

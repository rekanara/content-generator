-- 036: record AI style-sample suggestions in llm_runs (budget + usage see the spend).
alter table llm_runs drop constraint llm_runs_kind_check;
alter table llm_runs add constraint llm_runs_kind_check
  check (kind in ('planner', 'news_score', 'news_autofill', 'promo', 'polish', 'failed_run', 'pillars', 'styles'));

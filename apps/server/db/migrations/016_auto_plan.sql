-- 016: AI planner — per-group opt-in flag for automatic daily plan creation.
-- The planner (usecases/planner.ts) looks at the upcoming week's runs and creates
-- slot_override plans SPARINGLY (exceptions with justification, never a full schedule).
-- (no begin/commit — the migrate runner wraps each file in a transaction)

alter table groups add column auto_plan boolean not null default false;

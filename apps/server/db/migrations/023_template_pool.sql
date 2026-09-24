-- Template pool model: MULTIPLE active regular templates per format is the norm
-- (pipeline picks randomly for visual variety). The partial unique index from 004
-- that enforced exactly-one-active no longer holds — drop it. Override/promo types
-- keep their exclusive-activate semantics in the repo layer, not the DB.
drop index if exists templates_one_active;

-- Fast lookup for the active pool per (group, format).
create index if not exists templates_active_pool_idx on templates (group_id, format) where is_active;

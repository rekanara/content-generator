-- 012: one template row = one full visual package (cover + body + CTA).
-- Replaces 011's kind-row model: html_first/html_last live ON the template row
-- (nullable = that page falls back to body). Existing kind rows are MERGED into
-- their (group, format) body sibling, then kind is dropped and the unique index
-- returns to one-active-per-format.
-- (no begin/commit here — the migrate runner wraps each file in a transaction)

alter table templates add column html_first text, add column html_last text;

-- merge active first/last kind rows into the body row (per group+format).
-- EDGE: merge targets body rows regardless of is_active — a (group, format) with an
-- active first/last row but NO body row loses that html at the delete below. Acceptable
-- here (a first without a body was unusable anyway); a general migration would insert
-- a body row first.
update templates t
set html_first = f.html
from (
  select distinct on (group_id, format) group_id, format, html
  from templates where kind = 'first' and is_active
  order by group_id, format, updated_at desc
) f
where t.group_id = f.group_id and t.format = f.format and t.kind = 'body';

update templates t
set html_last = l.html
from (
  select distinct on (group_id, format) group_id, format, html
  from templates where kind = 'last' and is_active
  order by group_id, format, updated_at desc
) l
where t.group_id = l.group_id and t.format = l.format and t.kind = 'body';

-- kind rows are now redundant (merged above) — remove them
delete from templates where kind <> 'body';

-- drop the (group, format, kind) index BEFORE the kind column: Postgres auto-drops
-- any index containing the dropped column, which would break the drop below.
drop index templates_one_active;

alter table templates drop column kind;

create unique index templates_one_active on templates (group_id, format) where is_active;

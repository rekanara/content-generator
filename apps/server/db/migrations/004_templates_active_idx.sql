-- 004: fix 003 bug — unique (group_id, format) allowed only 1 template per format TOTAL.
-- Intent: 1 ACTIVE template per format. Replace constraint with a partial unique index.
begin;

alter table templates drop constraint templates_one_active;
create unique index templates_one_active on templates (group_id, format) where is_active;

commit;

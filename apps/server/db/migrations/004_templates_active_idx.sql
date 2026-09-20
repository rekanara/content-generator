-- 004: fix 003 bug — unique (group_id, format) membatasi 1 template per format TOTAL.
-- Intent: 1 template AKTIF per format. Ganti constraint dengan partial unique index.
begin;

alter table templates drop constraint templates_one_active;
create unique index templates_one_active on templates (group_id, format) where is_active;

commit;

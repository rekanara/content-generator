-- 005: every group MUST have a rotation_state row (PK group_id).
-- Seed groups missing one; default last_platform linkedin → next = instagram.
begin;

insert into rotation_state (group_id, last_platform, last_ig_format, last_li_format, last_pillar_id)
select g.id, 'linkedin', null, null, null
from groups g
where not exists (select 1 from rotation_state r where r.group_id = g.id)
on conflict do nothing;

commit;

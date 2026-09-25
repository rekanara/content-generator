-- 006: delete group → all its resources are deleted too (cascade).
-- Without this, group delete hits FK violation from rotation_state (and groups with content).
begin;
alter table rotation_state drop constraint if exists rotation_state_group_id_fkey;
alter table rotation_state add constraint rotation_state_group_id_fkey
  foreign key (group_id) references groups(id) on delete cascade;
alter table pillars drop constraint if exists pillars_group_id_fkey;
alter table pillars add constraint pillars_group_id_fkey
  foreign key (group_id) references groups(id) on delete cascade;
alter table templates drop constraint if exists templates_group_id_fkey;
alter table templates add constraint templates_group_id_fkey
  foreign key (group_id) references groups(id) on delete cascade;
alter table style_samples drop constraint if exists style_samples_group_id_fkey;
alter table style_samples add constraint style_samples_group_id_fkey
  foreign key (group_id) references groups(id) on delete cascade;
alter table posts drop constraint if exists posts_group_id_fkey;
alter table posts add constraint posts_group_id_fkey
  foreign key (group_id) references groups(id) on delete cascade;
commit;

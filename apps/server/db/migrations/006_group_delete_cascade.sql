-- 006: hapus group → semua resource miliknya ikut terhapus (cascade).
-- Tanpa ini delete group kena FK violation dari rotation_state (dan group berkonten).
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

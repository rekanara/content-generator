-- 003_groups: multi-account. 1 group = 1 account/brand. LLM/TTS/Telegram config
-- nullable → fall back to env. Cron per group. Slug used as the MinIO prefix.
begin;

create table groups (
  id uuid primary key default uuidv7(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  cron_expr text not null default '0 7 * * *',
  cron_enabled boolean not null default true,
  -- config override; null = use env
  llm_base_url text, llm_api_key text, llm_model text, llm_model_critic text,
  tts_provider text, tts_voice text, tts_base_url text, tts_api_key text, tts_model text,
  telegram_bot_token text, telegram_chat_id text,
  created_at timestamptz not null default now()
);

insert into groups (slug, name, cron_expr, cron_enabled)
select 'default', 'Default', s.cron_expr, s.cron_enabled
from settings s
on conflict (slug) do nothing;

-- backfill before setting not null
alter table pillars add column group_id uuid references groups(id);
alter table pillars drop constraint pillars_name_key;
alter table pillars add constraint pillars_name_unique unique (group_id, name);
update pillars set group_id = (select id from groups where slug = 'default');

alter table templates add column group_id uuid references groups(id);
alter table templates add constraint templates_one_active unique (group_id, format) deferrable initially deferred;
update templates set group_id = (select id from groups where slug = 'default');

alter table style_samples add column group_id uuid references groups(id);
update style_samples set group_id = (select id from groups where slug = 'default');

alter table rotation_state add column group_id uuid references groups(id);
update rotation_state set group_id = (select id from groups where slug = 'default');
alter table rotation_state drop constraint rotation_state_pkey;
alter table rotation_state add primary key (group_id);

alter table posts add column group_id uuid references groups(id);
update posts set group_id = (select id from groups where slug = 'default');

-- not null after backfill
alter table pillars alter column group_id set not null;
alter table templates alter column group_id set not null;
alter table style_samples alter column group_id set not null;
alter table rotation_state alter column group_id set not null;
alter table posts alter column group_id set not null;

create index pillars_group_idx on pillars (group_id, active, sort_order);
create index templates_group_idx on templates (group_id, format, is_active);
create index posts_group_idx on posts (group_id, created_at desc);
create index style_samples_group_idx on style_samples (group_id, platform);

-- cron moved to groups table
drop table settings;

commit;

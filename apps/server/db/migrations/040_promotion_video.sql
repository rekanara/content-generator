alter table promotions add column video_content jsonb;
alter table promotions add column video_audio_mode text not null default 'silent' check (video_audio_mode in ('silent', 'voice'));
alter table promotions add column video_artifact_prefix text;
alter table promotions add column video_duration_sec double precision;

-- 011: cover image feature — templates get a kind (body | first | last):
--   first = cover page ({{image}} token), last = CTA page, body = middle slides.
-- 1 active template per (group, format, kind). Existing rows default to 'body'.
-- groups.image_model: per-group image generation model (NULL = cover pages OFF —
--   per-group only, deliberately NO env fallback: opt-in feature, unlike core llm/tts config).
begin;

alter table groups add column image_model text;

alter table templates add column kind text not null default 'body'
  check (kind in ('body','first','last'));

-- 004's partial unique index (group, format) → widen to (group, format, kind)
drop index templates_one_active;
create unique index templates_one_active on templates (group_id, format, kind) where is_active;

commit;

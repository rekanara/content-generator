-- 010: rerendered event — same content, re-rendered with the current template
-- (e.g. template edited after the post was already sent/awaiting).
begin;

alter table post_events drop constraint post_events_event_check;
alter table post_events add constraint post_events_event_check
  check (event in ('generated','rendered','awaiting_approval','approved','sent','failed','resent','rejected','rerendered'));

commit;

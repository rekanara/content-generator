-- 013: manual cover flow — post pauses at 'awaiting_cover' when the group has no
-- image model (blank or literal 'empty') but the template package has a cover part.
-- The Telegram bot asks for the image; the uploaded photo is stored as
-- posts/<id>/cover.png in MinIO, then render continues (approval gate or direct send).
-- (no begin/commit — the migrate runner wraps each file in a transaction)

alter table posts drop constraint posts_status_check;
alter table posts add constraint posts_status_check
  check (status in ('queued','draft','rendered','awaiting_cover','awaiting_approval','sent','failed','rejected'));

alter table post_events drop constraint post_events_event_check;
alter table post_events add constraint post_events_event_check
  check (event in ('generated','rendered','awaiting_cover','cover_received','awaiting_approval','approved','sent','failed','resent','rejected','rerendered'));

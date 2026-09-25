-- 009: approval gate + workflow statuses.
-- groups.approval_required: render → await human approve (Telegram inline / FE) → send.
-- posts.status += awaiting_approval (deliberate pause — survives daemon restart, NOT boot-failed),
--   rejected (terminal, rotation NOT consumed — same guarantee as failed).
-- post_events.event += awaiting_approval, approved, rejected.
begin;

alter table groups add column approval_required boolean not null default false;

alter table posts drop constraint posts_status_check;
alter table posts add constraint posts_status_check
  check (status in ('queued','draft','rendered','awaiting_approval','sent','failed','rejected'));

alter table post_events drop constraint post_events_event_check;
alter table post_events add constraint post_events_event_check
  check (event in ('generated','rendered','awaiting_approval','approved','sent','failed','resent','rejected'));

commit;

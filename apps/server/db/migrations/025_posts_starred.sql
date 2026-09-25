-- Star posts: Jack's manual quality signal. Starred sent posts feed the planner
-- ("these resonated — lean toward similar angles") and mark style-sample
-- candidates. Simple boolean toggle, no analytics integration yet.
alter table posts add column if not exists starred boolean not null default false;

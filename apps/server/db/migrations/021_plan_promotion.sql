-- 021: plans.promotion_id — links a promotion plan to its promotion row.
alter table plans add column promotion_id uuid references promotions(id) on delete cascade;
create index plans_promotion on plans (promotion_id);

-- Template variety: which template package rendered this post.
-- Fresh renders pick from the ACTIVE pool (random, avoiding the group's last used
-- template for the same platform); rerenders pin back to this id for stability.
-- No FK — a deleted template leaves a dangling id that safely falls back to the pool.
alter table posts add column if not exists template_id uuid;



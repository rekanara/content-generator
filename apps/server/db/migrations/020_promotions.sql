-- 020: promotions — product promo content (AI-authored slides over a design-system template).
-- Template formats gain ig-carousel-promo / li-carousel-promo ({{content}} free-form model).
-- plans gains type 'promotion' (delivery via the plan funnel, rotation untouched).
-- (no begin/commit — the migrate runner wraps each file in a transaction)

alter table templates drop constraint templates_format_check;
alter table templates add constraint templates_format_check
  check (format in ('ig-carousel','li-carousel','reel','ig-carousel-promo','li-carousel-promo'));

alter table plans drop constraint plans_type_check;
alter table plans add constraint plans_type_check
  check (type in ('slot_override','override_content','promotion'));

create table promotions (
  id uuid primary key default uuidv7(),
  group_id uuid not null references groups(id) on delete cascade,
  name text not null,
  topic text not null default '',
  features jsonb not null default '[]'::jsonb,
  stacks jsonb not null default '[]'::jsonb,
  stats jsonb not null default '[]'::jsonb,
  price text not null default '',
  price_sale text not null default '',
  template_id uuid references templates(id) on delete set null,
  -- AI-authored content: slides[{html, image_prompt}] — html may embed {{image}};
  -- images stored in MinIO promotions/<id>/slide-NN.(png|jpg)
  content jsonb,
  status text not null default 'draft' check (status in ('draft','content_ready','awaiting_images','ready','sent')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index promotions_group_idx on promotions (group_id, status, created_at desc);

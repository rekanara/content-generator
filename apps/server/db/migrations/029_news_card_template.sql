alter table templates drop constraint templates_format_check;
alter table templates add constraint templates_format_check
  check (format in ('ig-carousel','li-carousel','reel','ig-carousel-promo','li-carousel-promo','ig-news-card'));

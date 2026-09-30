-- Relax the ideas text length check: /buat sessions and longer /ide texts
-- can carry full-paragraph content briefs, not just short topic lines.
alter table ideas drop constraint if exists ideas_text_check;
alter table ideas add constraint ideas_text_len check (length(text) between 3 and 4000);

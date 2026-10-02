-- Reject titles containing only PostgreSQL POSIX whitespace or U+FEFF.
-- Do not scan existing rows during deployment; enforce this on new and updated rows.
alter table public.expenses
  add constraint expenses_title_has_content
  check (title is null or replace(title, chr(65279), '') ~ '[^[:space:]]')
  not valid;

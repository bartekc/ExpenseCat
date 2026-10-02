-- Keep new titles safely below the composite B-tree index tuple limit.
-- Existing rows are not scanned; the constraint still applies to new and updated rows.
alter table public.expenses
  add constraint expenses_title_max_bytes
  check (title is null or octet_length(title) <= 1024)
  not valid;

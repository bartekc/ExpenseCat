# Implementation review fix follow-ups

## F2 — Validate the title byte constraint after auditing existing rows

The additive `20261002000000_limit_expense_title_bytes.sql` migration uses `NOT VALID` so it can be deployed without rejecting existing expense data. PostgreSQL enforces it for new and updated rows immediately, but older rows have not been checked.

After the migration reaches each deployed database, count existing non-null titles with `octet_length(title) > 1024`. If any exist, decide how to preserve or remediate them without silently truncating transaction descriptions. When no violations remain, run `alter table public.expenses validate constraint expenses_title_max_bytes;` and record the result. Do not assume local smoke data represents production.

## F3 — Validate the title content constraint after auditing existing rows

The additive `20261002000001_reject_whitespace_only_expense_titles.sql` migration also uses `NOT VALID`: it rejects new or updated whitespace-only titles immediately but does not scan pre-existing rows during deployment.

After deployment, audit existing non-null titles with `not (replace(title, chr(65279), '') ~ '[^[:space:]]')`. If any exist, decide how to preserve or remediate them without inventing or silently changing transaction descriptions. When none remain, run `alter table public.expenses validate constraint expenses_title_has_content;` and record the result.

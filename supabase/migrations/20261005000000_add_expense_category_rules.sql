-- Use Unicode lowercasing independently of the database's default locale.
-- Deterministic collation preserves accents; matching and unique keys use exact text.
create collation public.expense_match_unicode (provider = icu, locale = 'und', deterministic = true);

create function public.normalize_expense_match_text(p_text text)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $function$
  select btrim(regexp_replace(
    normalize(lower(normalize(p_text, NFC) collate public.expense_match_unicode), NFC) collate "C",
    -- Unicode White_Space plus U+FEFF; no locale-dependent POSIX character class.
    U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+' collate "C",
    ' ',
    'g'
  ));
$function$;

revoke all on function public.normalize_expense_match_text(text) from public, anon, authenticated;
grant execute on function public.normalize_expense_match_text(text) to authenticated;

create table public.expense_categories (
  code text primary key,
  label text not null,
  sort_order smallint not null unique
);

insert into public.expense_categories (code, label, sort_order) values
  ('groceries', 'Groceries', 1),
  ('eating_out', 'Eating out', 2),
  ('transport', 'Transport', 3),
  ('housing_bills', 'Housing & bills', 4),
  ('household', 'Household', 5),
  ('health', 'Health', 6),
  ('clothing', 'Clothing', 7),
  ('shopping', 'Shopping', 8),
  ('leisure', 'Leisure', 9),
  ('other', 'Other', 10);

alter table public.expense_categories enable row level security;
revoke all on table public.expense_categories from public, anon, authenticated;
grant select on table public.expense_categories to authenticated;

create policy "Authenticated users can read expense categories"
on public.expense_categories
for select
to authenticated
using (true);

create table public.expense_category_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  keyword text not null,
  normalized_keyword text collate "C" generated always as (public.normalize_expense_match_text(keyword)) stored not null,
  category_code text not null references public.expense_categories (code),
  created_at timestamptz not null default now(),
  constraint expense_category_rules_keyword_bytes check (octet_length(keyword) between 1 and 1024),
  constraint expense_category_rules_normalized_keyword_bytes check (octet_length(normalized_keyword) between 1 and 1024),
  constraint expense_category_rules_owner_keyword_unique unique (owner_id, normalized_keyword)
);

-- PostgreSQL text rejects U+0000 before constraint evaluation, including Data API writes.
alter table public.expense_category_rules enable row level security;
revoke all on table public.expense_category_rules from public, anon, authenticated;
grant select, insert, update, delete on table public.expense_category_rules to authenticated;

create policy "Users can read their own expense category rules"
on public.expense_category_rules
for select
to authenticated
using (owner_id = (select auth.uid()));

create policy "Users can create their own expense category rules"
on public.expense_category_rules
for insert
to authenticated
with check (owner_id = (select auth.uid()));

create policy "Users can update their own expense category rules"
on public.expense_category_rules
for update
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "Users can delete their own expense category rules"
on public.expense_category_rules
for delete
to authenticated
using (owner_id = (select auth.uid()));

create view public.expense_review
with (security_invoker = true)
as
select
  expense.id,
  expense.owner_id,
  expense.created_at,
  expense.transaction_date,
  expense.amount,
  expense.title,
  expense.currency,
  case when winner.category_count = 1 then winner.category_code else 'other' end as category_code,
  winner.category_count <> 1 as needs_review,
  case
    when winner.category_count = 0 then 'unmatched'
    when winner.category_count > 1 then 'ambiguous'
    else null
  end as review_reason
from public.expenses as expense
-- OFFSET 0 keeps the normalization in this lateral step, once per expense.
cross join lateral (
  select public.normalize_expense_match_text(expense.title) as title
  offset 0
) as normalized
cross join lateral (
  select min(longest.category_code) as category_code, count(distinct longest.category_code) as category_count
  from (
    select rule.category_code
    from public.expense_category_rules as rule
    where rule.owner_id = expense.owner_id
      and strpos(normalized.title collate "C", rule.normalized_keyword) > 0
    order by char_length(rule.normalized_keyword) desc
    fetch first 1 row with ties
  ) as longest
) as winner
where expense.transaction_date is not null
  and expense.amount is not null
  and expense.title is not null;

revoke all on table public.expense_review from public, anon, authenticated;
grant select on table public.expense_review to authenticated;

create function public.get_expense_category_totals(p_start_date date, p_end_date date)
returns table (
  category_code text,
  total_cents text,
  expense_count bigint,
  needs_review_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if p_start_date is null or p_end_date is null or p_start_date >= p_end_date then
    raise exception 'A non-null increasing date interval is required' using errcode = '22023';
  end if;

  return query
  select
    category.code,
    trunc(coalesce(totals.cents, 0))::text,
    coalesce(totals.expense_count, 0),
    coalesce(totals.needs_review_count, 0)
  from public.expense_categories as category
  left join (
    select
      review.category_code,
      sum(-review.amount * 100) as cents,
      count(*) as expense_count,
      count(*) filter (where review.needs_review) as needs_review_count
    from public.expense_review as review
    where review.transaction_date >= p_start_date
      and review.transaction_date < p_end_date
    group by review.category_code
  ) as totals on totals.category_code = category.code
  order by category.sort_order;
end;
$function$;

revoke all on function public.get_expense_category_totals(date, date) from public, anon, authenticated;
grant execute on function public.get_expense_category_totals(date, date) to authenticated;

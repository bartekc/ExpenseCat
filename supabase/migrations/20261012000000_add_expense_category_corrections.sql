-- Revisions are opaque equality tokens shared by rule and correction writes.
-- USAGE permits nextval, but not setval; gaps after rolled-back writes are normal.
create sequence public.expense_category_revision_seq as bigint no cycle;
revoke all on sequence public.expense_category_revision_seq from public, anon, authenticated;
grant usage on sequence public.expense_category_revision_seq to authenticated;

alter table public.expense_category_rules add column revision bigint;
update public.expense_category_rules
set revision = nextval('public.expense_category_revision_seq'::regclass);
alter table public.expense_category_rules
  alter column revision set not null,
  add constraint expense_category_rules_revision_positive check (revision > 0);

create table public.expense_category_corrections (
  expense_id uuid primary key references public.expenses (id) on delete cascade,
  category_code text references public.expense_categories (code),
  revision bigint not null,
  constraint expense_category_corrections_revision_positive check (revision > 0)
);

alter table public.expense_category_corrections enable row level security;
revoke all on table public.expense_category_corrections from public, anon, authenticated;
grant select, insert, update on table public.expense_category_corrections to authenticated;

create policy "Users can read their own expense category corrections"
on public.expense_category_corrections for select to authenticated
using (exists (
  select 1 from public.expenses as expense
  where expense.id = expense_id and expense.owner_id = (select auth.uid())
));

create policy "Users can create their own expense category corrections"
on public.expense_category_corrections for insert to authenticated
with check (exists (
  select 1 from public.expenses as expense
  where expense.id = expense_id and expense.owner_id = (select auth.uid())
));

create policy "Users can update their own expense category corrections"
on public.expense_category_corrections for update to authenticated
using (exists (
  select 1 from public.expenses as expense
  where expense.id = expense_id and expense.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.expenses as expense
  where expense.id = expense_id and expense.owner_id = (select auth.uid())
));

create function public.assign_expense_category_rule_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.revision := nextval('public.expense_category_revision_seq'::regclass);
  return new;
end;
$function$;

create function public.assign_expense_category_correction_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and new.expense_id is distinct from old.expense_id then
    raise exception 'Correction expense identity is immutable' using errcode = '22023';
  end if;
  -- Do not lock the parent here: RPCs already lock expense -> rule -> state.
  -- Direct state updates must remain observable by the RPC's final CAS.
  new.revision := nextval('public.expense_category_revision_seq'::regclass);
  return new;
end;
$function$;

revoke all on function public.assign_expense_category_rule_revision() from public, anon, authenticated;
revoke all on function public.assign_expense_category_correction_revision() from public, anon, authenticated;

create trigger assign_expense_category_rule_revision
before insert or update on public.expense_category_rules
for each row execute function public.assign_expense_category_rule_revision();

create trigger assign_expense_category_correction_revision
before insert or update on public.expense_category_corrections
for each row execute function public.assign_expense_category_correction_revision();

-- Append metadata without dropping the view, its grants or dependent aggregate.
create or replace view public.expense_review
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
  coalesce(correction.category_code,
    case when winner.category_count = 1 then winner.category_code else 'other' end) as category_code,
  correction.category_code is null and winner.category_count <> 1 as needs_review,
  case
    when correction.category_code is not null then null
    when winner.category_count = 0 then 'unmatched'
    when winner.category_count > 1 then 'ambiguous'
    else null
  end as review_reason,
  correction.category_code as manual_category_code,
  coalesce(correction.revision::text, '0') as correction_revision
from public.expenses as expense
left join public.expense_category_corrections as correction on correction.expense_id = expense.id
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

create function public.get_expense_correction_state(p_expense_id uuid, p_keyword text default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_owner_id uuid := auth.uid();
  v_normalized_keyword text;
  v_result jsonb;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_keyword is not null then
    if octet_length(p_keyword) not between 1 and 1024 then
      raise exception 'Invalid keyword' using errcode = '22023';
    end if;
    v_normalized_keyword := public.normalize_expense_match_text(p_keyword);
    if octet_length(v_normalized_keyword) not between 1 and 1024 then
      raise exception 'Invalid keyword' using errcode = '22023';
    end if;
  end if;

  -- A single statement/snapshot supplies both effective expense and exact rule.
  select jsonb_build_object(
    'expense', to_jsonb(review) - 'owner_id' - 'created_at',
    'rule', (
      select jsonb_build_object('id', rule.id, 'keyword', rule.keyword,
        'category_code', rule.category_code, 'revision', rule.revision::text)
      from public.expense_category_rules as rule
      where rule.owner_id = v_owner_id
        and rule.normalized_keyword = v_normalized_keyword collate "C"
    )
  ) into v_result
  from public.expense_review as review
  where review.id = p_expense_id and review.owner_id = v_owner_id;

  if not found then
    raise exception 'expense_not_found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$function$;

revoke all on function public.get_expense_correction_state(uuid, text) from public, anon, authenticated;
grant execute on function public.get_expense_correction_state(uuid, text) to authenticated;

create function public.correct_expense_category(
  p_expense_id uuid,
  p_expected_revision text,
  p_category_code text,
  p_learn_rule boolean,
  p_keyword text,
  p_confirm_rule_id uuid,
  p_confirm_rule_revision text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_owner_id uuid := auth.uid();
  v_title text;
  v_expected_revision bigint;
  v_current_revision bigint;
  v_normalized_keyword text;
  v_rule public.expense_category_rules%rowtype;
  v_rule_found boolean;
  v_rule_json jsonb := null;
  v_constraint text;
  v_written_revision bigint;
  v_result jsonb;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision !~ '^(0|[1-9][0-9]{0,18})$'
    or (length(p_expected_revision) = 19 and p_expected_revision collate "C" > '9223372036854775807') then
    raise exception 'Invalid expected revision' using errcode = '22023';
  end if;
  v_expected_revision := p_expected_revision::bigint;
  if p_learn_rule is null or (p_confirm_rule_id is null) <> (p_confirm_rule_revision is null)
    or (not p_learn_rule and (p_keyword is not null or p_confirm_rule_id is not null)) then
    raise exception 'Invalid correction arguments' using errcode = '22023';
  end if;
  if p_confirm_rule_revision is not null then
    if p_confirm_rule_revision !~ '^[1-9][0-9]{0,18}$'
      or (length(p_confirm_rule_revision) = 19 and p_confirm_rule_revision collate "C" > '9223372036854775807') then
      raise exception 'Invalid rule revision' using errcode = '22023';
    end if;
  end if;
  if p_category_code is null or not exists (
    select 1 from public.expense_categories where code = p_category_code
  ) then
    raise exception 'Invalid category' using errcode = '22023';
  end if;

  -- Lock without rewriting transaction data or validating legacy update constraints.
  select expense.title into v_title
  from public.expenses as expense
  where expense.id = p_expense_id and expense.owner_id = v_owner_id
    and expense.transaction_date is not null and expense.amount is not null and expense.title is not null
  for update;
  if not found then
    raise exception 'expense_not_found' using errcode = 'P0002';
  end if;

  select correction.revision into v_current_revision
  from public.expense_category_corrections as correction where correction.expense_id = p_expense_id;
  if coalesce(v_current_revision, 0) <> v_expected_revision then
    raise exception 'expense_conflict' using errcode = 'P0001';
  end if;

  if p_learn_rule then
    if p_keyword is null or octet_length(p_keyword) not between 1 and 1024 then
      raise exception 'Invalid keyword' using errcode = '22023';
    end if;
    v_normalized_keyword := public.normalize_expense_match_text(p_keyword);
    if octet_length(v_normalized_keyword) not between 1 and 1024
      or strpos(public.normalize_expense_match_text(v_title) collate "C", v_normalized_keyword collate "C") = 0 then
      raise exception 'Keyword must be a literal normalized title fragment' using errcode = '22023';
    end if;

    select rule.* into v_rule
    from public.expense_category_rules as rule
    where rule.owner_id = v_owner_id and rule.normalized_keyword = v_normalized_keyword collate "C"
    for update;
    v_rule_found := found;
    if v_rule_found then
      v_rule_json := jsonb_build_object('id', v_rule.id, 'keyword', v_rule.keyword,
        'category_code', v_rule.category_code, 'revision', v_rule.revision::text);
    end if;

    -- Even a now-same-category rule does not validate a stale confirmation.
    if p_confirm_rule_id is not null then
      if not v_rule_found or v_rule.id <> p_confirm_rule_id or v_rule.revision <> p_confirm_rule_revision::bigint then
        raise exception 'rule_conflict' using errcode = 'P0001',
          detail = jsonb_build_object('rule', v_rule_json)::text;
      end if;
      update public.expense_category_rules set category_code = p_category_code
      where id = v_rule.id and owner_id = v_owner_id
      returning * into v_rule;
    elsif v_rule_found then
      if v_rule.category_code <> p_category_code then
        raise exception 'rule_confirmation_required' using errcode = 'P0001',
          detail = jsonb_build_object('rule', v_rule_json)::text;
      end if;
      -- Same-category reuse retains the raw phrase and revision, under its lock.
    else
      begin
        insert into public.expense_category_rules (owner_id, keyword, category_code)
        values (v_owner_id, p_keyword, p_category_code)
        returning * into v_rule;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint <> 'expense_category_rules_owner_keyword_unique' then
          raise;
        end if;
        -- An absent-rule race is a conflict, even if the competing category agrees.
        select rule.* into v_rule
        from public.expense_category_rules as rule
        where rule.owner_id = v_owner_id and rule.normalized_keyword = v_normalized_keyword collate "C"
        for update;
        v_rule_json := null;
        if found then
          v_rule_json := jsonb_build_object('id', v_rule.id, 'keyword', v_rule.keyword,
            'category_code', v_rule.category_code, 'revision', v_rule.revision::text);
        end if;
        raise exception 'rule_conflict' using errcode = 'P0001',
          detail = jsonb_build_object('rule', v_rule_json)::text;
      end;
    end if;
    v_rule_json := jsonb_build_object('id', v_rule.id, 'keyword', v_rule.keyword,
      'category_code', v_rule.category_code, 'revision', v_rule.revision::text);
  end if;

  -- Final CAS detects direct owner state writes occurring while the rule is locked.
  -- Raising (rather than returning an error) rolls back any preceding rule change.
  if v_expected_revision = 0 then
    begin
      insert into public.expense_category_corrections (expense_id, category_code)
      values (p_expense_id, p_category_code)
      returning revision into v_written_revision;
    exception when unique_violation then
      raise exception 'expense_conflict' using errcode = 'P0001';
    end;
  else
    update public.expense_category_corrections set category_code = p_category_code
    where expense_id = p_expense_id and revision = v_expected_revision
    returning revision into v_written_revision;
    if not found then
      raise exception 'expense_conflict' using errcode = 'P0001';
    end if;
  end if;

  v_result := public.get_expense_correction_state(p_expense_id);
  return jsonb_set(v_result, '{rule}', coalesce(v_rule_json, 'null'::jsonb));
end;
$function$;

revoke all on function public.correct_expense_category(uuid, text, text, boolean, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.correct_expense_category(uuid, text, text, boolean, text, uuid, text) to authenticated;

create function public.reset_expense_category(p_expense_id uuid, p_expected_revision text)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_owner_id uuid := auth.uid();
  v_expected_revision bigint;
  v_current_revision bigint;
  v_written_revision bigint;
begin
  if v_owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision !~ '^(0|[1-9][0-9]{0,18})$'
    or (length(p_expected_revision) = 19 and p_expected_revision collate "C" > '9223372036854775807') then
    raise exception 'Invalid expected revision' using errcode = '22023';
  end if;
  v_expected_revision := p_expected_revision::bigint;

  perform 1 from public.expenses as expense
  where expense.id = p_expense_id and expense.owner_id = v_owner_id
    and expense.transaction_date is not null and expense.amount is not null and expense.title is not null
  for update;
  if not found then
    raise exception 'expense_not_found' using errcode = 'P0002';
  end if;

  select correction.revision into v_current_revision
  from public.expense_category_corrections as correction where correction.expense_id = p_expense_id;
  if coalesce(v_current_revision, 0) <> v_expected_revision then
    raise exception 'expense_conflict' using errcode = 'P0001';
  end if;

  if v_expected_revision = 0 then
    begin
      insert into public.expense_category_corrections (expense_id, category_code)
      values (p_expense_id, null)
      returning revision into v_written_revision;
    exception when unique_violation then
      raise exception 'expense_conflict' using errcode = 'P0001';
    end;
  else
    update public.expense_category_corrections set category_code = null
    where expense_id = p_expense_id and revision = v_expected_revision
    returning revision into v_written_revision;
    if not found then
      raise exception 'expense_conflict' using errcode = 'P0001';
    end if;
  end if;
  return public.get_expense_correction_state(p_expense_id);
end;
$function$;

revoke all on function public.reset_expense_category(uuid, text) from public, anon, authenticated;
grant execute on function public.reset_expense_category(uuid, text) to authenticated;

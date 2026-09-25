create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.expenses enable row level security;

grant select, insert, update, delete on table public.expenses to authenticated;

create policy "Users can read their own expenses"
on public.expenses
for select
to authenticated
using (owner_id = auth.uid());

create policy "Users can create their own expenses"
on public.expenses
for insert
to authenticated
with check (owner_id = auth.uid());

create policy "Users can update their own expenses"
on public.expenses
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "Users can delete their own expenses"
on public.expenses
for delete
to authenticated
using (owner_id = auth.uid());

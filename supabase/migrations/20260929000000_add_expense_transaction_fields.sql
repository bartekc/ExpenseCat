alter table public.expenses
  add column transaction_date date,
  add column amount numeric(12, 2),
  add column title text,
  add column currency text not null default 'PLN';

alter table public.expenses
  add constraint expenses_amount_negative check (amount is null or amount < 0),
  add constraint expenses_title_nonblank check (title is null or btrim(title) <> ''),
  add constraint expenses_currency_pln check (currency = 'PLN'),
  add constraint expenses_owner_transaction_unique unique (owner_id, transaction_date, amount, title);

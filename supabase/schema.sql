-- ============================================================
--  My Money Tracker — database schema for Supabase (PostgreSQL)
--  How to run: Supabase Dashboard → SQL Editor → New query →
--  paste this whole file → Run.  Safe to run more than once.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Categories (income / expense) ----------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  type        text not null check (type in ('income', 'expense')),
  created_at  timestamptz not null default now(),
  unique (user_id, type, name)
);

-- ---------- Loans ----------
create table if not exists public.loans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  principal   numeric(14,2) not null default 0 check (principal >= 0),
  emi_amount  numeric(14,2) not null check (emi_amount >= 0),
  total_emis  integer not null check (total_emis > 0),
  emis_paid   integer not null default 0 check (emis_paid >= 0),
  start_date  date,
  created_at  timestamptz not null default now()
);

-- ---------- Transactions (every income and expense entry) ----------
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type         text not null check (type in ('income', 'expense')),
  category_id  uuid references public.categories (id) on delete restrict,
  loan_id      uuid references public.loans (id) on delete set null,   -- set when the expense is an EMI payment
  amount       numeric(14,2) not null check (amount > 0),
  txn_date     date not null default current_date,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, txn_date desc);

-- ---------- Per-user settings (savings goal) ----------
create table if not exists public.settings (
  user_id                uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  savings_target_pct     numeric(5,2) not null default 20 check (savings_target_pct between 0 and 100),
  savings_target_amount  numeric(14,2) check (savings_target_amount is null or savings_target_amount >= 0),
  updated_at             timestamptz not null default now()
);

-- ---------- Row Level Security: every user sees only their own rows ----------
alter table public.categories   enable row level security;
alter table public.loans        enable row level security;
alter table public.transactions enable row level security;
alter table public.settings     enable row level security;

drop policy if exists "own categories"   on public.categories;
drop policy if exists "own loans"        on public.loans;
drop policy if exists "own transactions" on public.transactions;
drop policy if exists "own settings"     on public.settings;

create policy "own categories" on public.categories
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own loans" on public.loans
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own transactions" on public.transactions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own settings" on public.settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Helpful view: month-wise totals per user (optional) ----------
create or replace view public.monthly_totals
with (security_invoker = true) as
select
  user_id,
  to_char(txn_date, 'YYYY-MM')                                    as month,
  sum(amount) filter (where type = 'income')                      as income,
  sum(amount) filter (where type = 'expense')                     as expenses,
  sum(amount) filter (where type = 'expense' and loan_id is not null) as emi,
  coalesce(sum(amount) filter (where type = 'income'), 0)
    - coalesce(sum(amount) filter (where type = 'expense'), 0)    as savings
from public.transactions
group by user_id, to_char(txn_date, 'YYYY-MM');

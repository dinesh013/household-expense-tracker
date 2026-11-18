-- Household Expense Tracker — tables and constraints.
-- Amounts are numeric(12,2) rupees; settlement maths runs in integer paise.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  created_at   timestamptz not null default now()
);

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- Members are soft-removed (removed_at) so past months keep the right participants.
create table public.household_members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         text not null check (role in ('owner', 'member', 'viewer')),
  joined_at    timestamptz not null default now(),
  removed_at   timestamptz
);
-- One active household per person keeps the UI simple.
create unique index household_members_one_active_household
  on public.household_members (user_id) where removed_at is null;
create unique index household_members_one_owner
  on public.household_members (household_id) where role = 'owner' and removed_at is null;
create index household_members_household on public.household_members (household_id);

-- Invites are shareable links: the Owner sends /join/<token> however they like (no emails).
-- Single use, expire after 7 days, cancellable. `label` is an optional note like "Priya".
create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token        text not null unique
               default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  label        text check (label is null or char_length(btrim(label)) between 1 and 60),
  role         text not null check (role in ('member', 'viewer')),
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  invited_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_by  uuid references public.profiles (id),
  responded_at timestamptz
);
create index household_invites_household on public.household_invites (household_id) where status = 'pending';

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create unique index categories_unique_name on public.categories (household_id, lower(btrim(name)));

create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  amount       numeric(12, 2) not null check (amount > 0 and amount <= 10000000),
  description  text not null check (char_length(btrim(description)) between 1 and 120),
  category_id  uuid not null references public.categories (id),
  expense_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  paid_by      uuid not null references public.profiles (id),
  logged_by    uuid not null references public.profiles (id),
  note         text check (note is null or char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index expenses_household_date on public.expenses (household_id, expense_date desc);

create table public.expense_history (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  action       text not null check (action in ('created', 'updated')),
  changed_by   uuid references public.profiles (id),
  changed_at   timestamptz not null default now(),
  changes      jsonb not null default '{}'::jsonb
);
create index expense_history_expense on public.expense_history (expense_id, changed_at desc);

-- A row exists once the Owner has closed a month at least once.
-- status = 'reopened' means the Owner unlocked it for corrections.
create table public.month_closures (
  household_id uuid not null references public.households (id) on delete cascade,
  year         int  not null check (year between 2000 and 2100),
  month        int  not null check (month between 1 and 12),
  status       text not null check (status in ('closed', 'reopened')),
  snapshot     jsonb not null,
  closed_at    timestamptz not null default now(),
  closed_by    uuid references public.profiles (id),
  reopened_at  timestamptz,
  reopened_by  uuid references public.profiles (id),
  primary key (household_id, year, month)
);

create table public.settlement_payments (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  year         int  not null,
  month        int  not null,
  from_user    uuid not null references public.profiles (id),
  to_user      uuid not null references public.profiles (id),
  -- amount 0 = a payment that was marked paid, then no longer owed after a reopen + recalculation.
  amount       numeric(12, 2) not null check (amount >= 0),
  paid_on      date,
  paid_amount  numeric(12, 2) check (paid_amount is null or paid_amount > 0),
  marked_by    uuid references public.profiles (id),
  marked_at    timestamptz,
  foreign key (household_id, year, month)
    references public.month_closures (household_id, year, month) on delete cascade
);
create index settlement_payments_month on public.settlement_payments (household_id, year, month);

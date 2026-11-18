-- Helper functions, validation triggers and edit history.

create or replace function public.ist_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- Role of the signed-in user in a household (null if not an active member).
-- security definer so RLS policies can call it without recursing into household_members' own policy.
create or replace function public.household_role(p_household uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from household_members
  where household_id = p_household and user_id = auth.uid() and removed_at is null
$$;

create or replace function public.is_household_member(p_household uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.household_role(p_household) is not null
$$;

create or replace function public.can_write_household(p_household uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.household_role(p_household) in ('owner', 'member'), false)
$$;

create or replace function public.is_household_owner(p_household uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.household_role(p_household) = 'owner', false)
$$;

-- True if p_user is (or was) in a household the signed-in user is an active member of.
create or replace function public.shares_household_with(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from household_members me
    join household_members them on them.household_id = me.household_id
    where me.user_id = auth.uid() and me.removed_at is null and them.user_id = p_user
  )
$$;

create or replace function public.is_month_locked(p_household uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from month_closures
    where household_id = p_household
      and year = extract(year from p_date)::int
      and month = extract(month from p_date)::int
      and status = 'closed'
  )
$$;

-- New auth user -> profile row.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name)
  values (
    new.id,
    lower(new.email),
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 60)
  );
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Server-side validation for expenses. RLS decides *who* may write; this decides *what* is valid.
create or replace function public.expenses_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and is_month_locked(old.household_id, old.expense_date) then
    raise exception 'This month is closed. Ask the Owner to reopen it before changing its expenses.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- BEFORE triggers run ahead of RLS WITH CHECK, so reject non-writers here with a clear message.
  if auth.uid() is not null and not can_write_household(new.household_id) then
    raise exception 'You do not have permission to add or edit expenses in this household.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.logged_by  := coalesce(auth.uid(), new.logged_by);
    new.created_at := now();
  else
    new.household_id := old.household_id;
    new.logged_by    := old.logged_by;
    new.created_at   := old.created_at;
  end if;

  if is_month_locked(new.household_id, new.expense_date) then
    raise exception 'That month is closed. Ask the Owner to reopen it before adding expenses to it.'
      using errcode = 'P0001';
  end if;

  new.description := btrim(coalesce(new.description, ''));
  new.note        := nullif(btrim(coalesce(new.note, '')), '');
  new.updated_at  := now();

  if new.description = '' then
    raise exception 'Description is required.' using errcode = '23514';
  end if;

  if new.expense_date > ist_today() then
    raise exception 'Expense date cannot be in the future.' using errcode = '23514';
  end if;

  if not exists (select 1 from categories where id = new.category_id and household_id = new.household_id) then
    raise exception 'Category does not belong to this household.' using errcode = '23514';
  end if;

  if (tg_op = 'INSERT' or new.paid_by is distinct from old.paid_by) and not exists (
    select 1 from household_members
    where household_id = new.household_id and user_id = new.paid_by
      and role in ('owner', 'member') and removed_at is null
  ) then
    raise exception 'Paid by must be an Owner or Member of this household.' using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger expenses_guard
  before insert or update or delete on public.expenses
  for each row execute function public.expenses_guard();

create or replace function public.expenses_record_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into expense_history (expense_id, household_id, action, changed_by)
    values (new.id, new.household_id, 'created', new.logged_by);
    return new;
  end if;

  if new.amount is distinct from old.amount then
    v_changes := v_changes || jsonb_build_object('amount', jsonb_build_object('from', old.amount, 'to', new.amount));
  end if;
  if new.description is distinct from old.description then
    v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('from', old.description, 'to', new.description));
  end if;
  if new.category_id is distinct from old.category_id then
    v_changes := v_changes || jsonb_build_object('category_id', jsonb_build_object('from', old.category_id, 'to', new.category_id));
  end if;
  if new.expense_date is distinct from old.expense_date then
    v_changes := v_changes || jsonb_build_object('expense_date', jsonb_build_object('from', old.expense_date, 'to', new.expense_date));
  end if;
  if new.paid_by is distinct from old.paid_by then
    v_changes := v_changes || jsonb_build_object('paid_by', jsonb_build_object('from', old.paid_by, 'to', new.paid_by));
  end if;
  if new.note is distinct from old.note then
    v_changes := v_changes || jsonb_build_object('note', jsonb_build_object('from', old.note, 'to', new.note));
  end if;

  if v_changes <> '{}'::jsonb then
    insert into expense_history (expense_id, household_id, action, changed_by, changes)
    values (new.id, new.household_id, 'updated', auth.uid(), v_changes);
  end if;
  return new;
end
$$;

create trigger expenses_record_history
  after insert or update on public.expenses
  for each row execute function public.expenses_record_history();

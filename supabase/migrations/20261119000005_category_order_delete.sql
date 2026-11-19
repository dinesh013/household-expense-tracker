-- Owner-only category reordering and deletion (2026-11-19).
-- Applied on top of 0001–0004, which are already live: run this file once in the Supabase SQL Editor.

-- How many expenses use each category, and how many of those sit in closed (locked) months.
-- Used by the Categories screen to explain what deleting a category will do.
create or replace function public.category_usage(p_household uuid)
returns table (category_id uuid, expense_count int, locked_count int)
language sql stable security definer set search_path = public as $$
  select c.id,
         count(e.id)::int,
         count(e.id) filter (where public.is_month_locked(c.household_id, e.expense_date))::int
  from categories c
  left join expenses e on e.category_id = c.id
  where c.household_id = p_household
    and public.is_household_member(p_household)
  group by c.id
$$;

-- Saves a new order. p_ids must list every category of the household exactly once.
create or replace function public.reorder_categories(p_household uuid, p_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_expected int;
begin
  if not public.is_household_owner(p_household) then
    raise exception 'Only the Owner can reorder categories.' using errcode = '42501';
  end if;
  select count(*) into v_expected from categories where household_id = p_household;
  if coalesce(cardinality(p_ids), 0) <> v_expected
     or (select count(distinct x) from unnest(p_ids) x) <> v_expected
     or exists (select 1 from unnest(p_ids) x
                where not exists (select 1 from categories c where c.id = x and c.household_id = p_household)) then
    raise exception 'The category list changed. Refresh and try again.' using errcode = '22023';
  end if;
  update categories c
  set sort_order = o.pos
  from unnest(p_ids) with ordinality as o(id, pos)
  where c.id = o.id and c.household_id = p_household;
end;
$$;

-- Deletes a category. Its expenses move to p_move_to first (recorded in each expense's edit history).
-- Refused while any of them is in a closed month, so a final settlement never changes underneath anyone.
create or replace function public.delete_category(p_category uuid, p_move_to uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_household uuid;
  v_used int;
  v_locked int;
begin
  select household_id into v_household from categories where id = p_category;
  if v_household is null or not public.is_household_owner(v_household) then
    raise exception 'Only the Owner can delete categories.' using errcode = '42501';
  end if;
  if (select count(*) from categories where household_id = v_household) <= 1 then
    raise exception 'Keep at least one category.' using errcode = '22023';
  end if;

  select count(*), count(*) filter (where public.is_month_locked(v_household, expense_date))
  into v_used, v_locked
  from expenses where category_id = p_category;

  if v_locked > 0 then
    raise exception '% of its expenses are in closed months. Reopen those months first, or rename the category instead.', v_locked
      using errcode = '22023';
  end if;
  if v_used > 0 then
    if p_move_to is null or p_move_to = p_category
       or not exists (select 1 from categories where id = p_move_to and household_id = v_household) then
      raise exception 'Choose another category to move its expenses to.' using errcode = '22023';
    end if;
    -- Goes through expenses_guard (lock + permission checks) and the edit-history trigger.
    update expenses set category_id = p_move_to where category_id = p_category;
  end if;

  delete from categories where id = p_category;
end;
$$;

revoke all on function public.category_usage(uuid), public.reorder_categories(uuid, uuid[]), public.delete_category(uuid, uuid)
  from public, anon;
grant execute on function public.category_usage(uuid), public.reorder_categories(uuid, uuid[]), public.delete_category(uuid, uuid)
  to authenticated;

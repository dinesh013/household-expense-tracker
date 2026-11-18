-- Row Level Security on every table, plus least-privilege grants.
-- Reads: any active member. Expense writes: Owner/Member. Admin actions go through the RPCs.

alter table public.profiles            enable row level security;
alter table public.households          enable row level security;
alter table public.household_members   enable row level security;
alter table public.household_invites   enable row level security;
alter table public.categories          enable row level security;
alter table public.expenses            enable row level security;
alter table public.expense_history     enable row level security;
alter table public.month_closures      enable row level security;
alter table public.settlement_payments enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_household_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy households_select on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_update on public.households for update to authenticated
  using (public.is_household_owner(id)) with check (public.is_household_owner(id));

create policy members_select on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

create policy invites_select on public.household_invites for select to authenticated
  using (public.is_household_owner(household_id));

create policy categories_select on public.categories for select to authenticated
  using (public.is_household_member(household_id));
create policy categories_insert on public.categories for insert to authenticated
  with check (public.is_household_owner(household_id));
create policy categories_update on public.categories for update to authenticated
  using (public.is_household_owner(household_id)) with check (public.is_household_owner(household_id));

create policy expenses_select on public.expenses for select to authenticated
  using (public.is_household_member(household_id));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.can_write_household(household_id));
create policy expenses_update on public.expenses for update to authenticated
  using (public.can_write_household(household_id)) with check (public.can_write_household(household_id));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.can_write_household(household_id));

create policy history_select on public.expense_history for select to authenticated
  using (public.is_household_member(household_id));

create policy closures_select on public.month_closures for select to authenticated
  using (public.is_household_member(household_id));

create policy payments_select on public.settlement_payments for select to authenticated
  using (public.is_household_member(household_id));

-- Grants: nothing for anon; column-scoped writes for authenticated.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant update (name) on public.households to authenticated;
grant insert (household_id, name, sort_order), update (name, sort_order) on public.categories to authenticated;
grant insert (household_id, amount, description, category_id, expense_date, paid_by, note),
      update (amount, description, category_id, expense_date, paid_by, note),
      delete
  on public.expenses to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
-- Used inside RLS policies, so the caller needs EXECUTE. They only reveal the caller's own role.
grant execute on function
  public.ist_today(),
  public.household_role(uuid),
  public.is_household_member(uuid),
  public.can_write_household(uuid),
  public.is_household_owner(uuid),
  public.shares_household_with(uuid),
  public.is_month_locked(uuid, date)
  to authenticated;
-- Client-callable RPCs (each checks the caller's role itself).
grant execute on function
  public.get_month_summary(uuid, int, int),
  public.close_month(uuid, int, int),
  public.reopen_month(uuid, int, int),
  public.mark_payment(uuid, date),
  public.create_household(text),
  public.create_invite(uuid, text, text),
  public.cancel_invite(uuid),
  public.get_invite(text),
  public.accept_invite(text),
  public.change_member_role(uuid, text),
  public.remove_member(uuid),
  public.leave_household()
  to authenticated;
-- compute_settlement and close_month_internal stay server-only.

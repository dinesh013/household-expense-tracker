-- Members can add expenses but not edit or delete them; they raise a change request instead (2026-11-20).
-- Applied on top of 0001–0006, which are already live: run this file once in the Supabase SQL Editor.
--
-- * Editing and deleting expenses is now Owner-only (RLS). Members and the Owner can still add expenses.
-- * A Member (or the Owner) can ask for an expense to be changed or deleted, with a reason.
-- * The Owner approves (the change is applied straight away and shows in the activity log as the Owner's edit)
--   or rejects with a reason. The requester can cancel while it is pending.

-- 1. Owner-only edit and delete.
drop policy if exists expenses_update on public.expenses;
drop policy if exists expenses_delete on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (public.is_household_owner(household_id)) with check (public.is_household_owner(household_id));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.is_household_owner(household_id));

-- 2. Change requests.
create table if not exists public.change_requests (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  -- No foreign key: the request (and its outcome) stays on record after the expense is deleted.
  expense_id    uuid not null,
  kind          text not null check (kind in ('edit', 'delete')),
  -- For 'edit': only the fields to change, e.g. {"amount": 150, "note": "..."}.
  changes       jsonb not null default '{}'::jsonb,
  -- The expense as it was when the request was raised (to show "from → to").
  expense_snapshot jsonb not null,
  reason        text not null check (char_length(btrim(reason)) between 1 and 300),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by  uuid not null references public.profiles (id),
  requested_at  timestamptz not null default now(),
  decided_by    uuid references public.profiles (id),
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 300)
);
create index if not exists change_requests_household on public.change_requests (household_id, requested_at desc);
-- One open request per expense at a time.
create unique index if not exists change_requests_one_pending on public.change_requests (expense_id) where status = 'pending';

alter table public.change_requests enable row level security;
drop policy if exists change_requests_select on public.change_requests;
create policy change_requests_select on public.change_requests for select to authenticated
  using (public.is_household_member(household_id));
-- No insert/update/delete policies or grants: all writes go through the functions below.
revoke all on public.change_requests from anon, authenticated;
grant select on public.change_requests to authenticated;

-- Checks requested values the same way expenses_guard would, so a bad request fails now, not at approval.
create or replace function public.check_requested_changes(p_household uuid, p_changes jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  k text;
  v_amount numeric;
  v_date date;
begin
  for k in select jsonb_object_keys(p_changes) loop
    if k not in ('amount', 'description', 'category_id', 'expense_date', 'paid_by', 'note') then
      raise exception 'Unknown field: %', k using errcode = '22023';
    end if;
  end loop;

  if p_changes ? 'amount' then
    begin
      v_amount := (p_changes ->> 'amount')::numeric;
    exception when others then
      raise exception 'Enter a valid amount.' using errcode = '22023';
    end;
    if v_amount is null or v_amount <= 0 or v_amount > 10000000 or v_amount <> round(v_amount, 2) then
      raise exception 'Enter an amount between ₹0.01 and ₹1,00,00,000.' using errcode = '22023';
    end if;
  end if;
  if p_changes ? 'description' and char_length(btrim(coalesce(p_changes ->> 'description', ''))) not between 1 and 120 then
    raise exception 'Description is required (up to 120 characters).' using errcode = '22023';
  end if;
  if p_changes ? 'note' and char_length(coalesce(p_changes ->> 'note', '')) > 500 then
    raise exception 'Keep the note under 500 characters.' using errcode = '22023';
  end if;
  if p_changes ? 'expense_date' then
    begin
      v_date := (p_changes ->> 'expense_date')::date;
    exception when others then
      raise exception 'Enter a valid date.' using errcode = '22023';
    end;
    if v_date is null or v_date > ist_today() then
      raise exception 'Expense date cannot be in the future.' using errcode = '22023';
    end if;
  end if;
  if p_changes ? 'category_id' and not exists (
    select 1 from categories where id::text = p_changes ->> 'category_id' and household_id = p_household
  ) then
    raise exception 'Category does not belong to this household.' using errcode = '22023';
  end if;
  if p_changes ? 'paid_by' and not exists (
    select 1 from household_members where household_id = p_household and user_id::text = p_changes ->> 'paid_by'
      and role in ('owner', 'member') and removed_at is null
  ) then
    raise exception 'Paid by must be an Owner or Member of this household.' using errcode = '22023';
  end if;
end
$$;

-- Raise a request. p_kind 'edit' needs at least one field that differs from the expense; 'delete' ignores p_changes.
create or replace function public.request_expense_change(p_expense uuid, p_kind text, p_changes jsonb, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e expenses%rowtype;
  v_snap jsonb;
  v_changes jsonb := '{}'::jsonb;
  k text;
  v_id uuid;
begin
  select * into e from expenses where id = p_expense;
  if not found or not can_write_household(e.household_id) then
    raise exception 'Expense not found.' using errcode = 'P0002';
  end if;
  if p_kind not in ('edit', 'delete') then
    raise exception 'Choose whether to change or delete the expense.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 300 then
    raise exception 'Give a short reason (up to 300 characters).' using errcode = '22023';
  end if;
  if exists (select 1 from change_requests where expense_id = p_expense and status = 'pending') then
    raise exception 'There is already a pending request for this expense.' using errcode = '23505';
  end if;

  v_snap := expense_snapshot(e);
  if p_kind = 'edit' then
    if jsonb_typeof(coalesce(p_changes, 'null'::jsonb)) <> 'object' then
      raise exception 'Nothing to change.' using errcode = '22023';
    end if;
    perform check_requested_changes(e.household_id, p_changes);
    -- Keep only fields that actually change (amounts compared as numbers, text trimmed, empty note = no note).
    for k in select jsonb_object_keys(p_changes) loop
      if (k = 'amount' and (p_changes ->> k)::numeric is distinct from e.amount)
        or (k = 'description' and btrim(p_changes ->> k) is distinct from e.description)
        or (k = 'note' and nullif(btrim(coalesce(p_changes ->> k, '')), '') is distinct from e.note)
        or (k = 'expense_date' and (p_changes ->> k)::date is distinct from e.expense_date)
        or (k = 'category_id' and p_changes ->> k is distinct from e.category_id::text)
        or (k = 'paid_by' and p_changes ->> k is distinct from e.paid_by::text) then
        v_changes := v_changes || jsonb_build_object(k,
          case k
            when 'amount' then to_jsonb((p_changes ->> k)::numeric)
            when 'description' then to_jsonb(btrim(p_changes ->> k))
            when 'note' then to_jsonb(nullif(btrim(coalesce(p_changes ->> k, '')), ''))
            else p_changes -> k
          end);
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      raise exception 'Nothing to change: the new values match the expense.' using errcode = '22023';
    end if;
  end if;

  insert into change_requests (household_id, expense_id, kind, changes, expense_snapshot, reason, requested_by)
  values (e.household_id, e.id, p_kind, v_changes, v_snap, btrim(p_reason), auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

-- The requester withdraws a pending request.
create or replace function public.cancel_change_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update change_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
  where id = p_request and status = 'pending' and requested_by = auth.uid()
    and is_household_member(household_id);
  if not found then
    raise exception 'This request can no longer be cancelled.' using errcode = 'P0002';
  end if;
end
$$;

-- Owner approves (applies the change) or rejects (reason required).
create or replace function public.decide_change_request(p_request uuid, p_approve boolean, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r change_requests%rowtype;
  c jsonb;
begin
  select * into r from change_requests where id = p_request for update;
  if not found or not is_household_member(r.household_id) then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if not is_household_owner(r.household_id) then
    raise exception 'Only the Owner can approve or reject change requests.' using errcode = '42501';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been %.', r.status using errcode = 'P0001';
  end if;
  if char_length(coalesce(p_note, '')) > 300 then
    raise exception 'Keep the note under 300 characters.' using errcode = '22023';
  end if;

  if not p_approve then
    if char_length(btrim(coalesce(p_note, ''))) = 0 then
      raise exception 'Give a reason for rejecting.' using errcode = '22023';
    end if;
  else
    if not exists (select 1 from expenses where id = r.expense_id) then
      raise exception 'The expense no longer exists. Reject the request instead.' using errcode = 'P0002';
    end if;
    -- Both go through expenses_guard (closed-month lock, validation) and the activity-log trigger.
    if r.kind = 'delete' then
      delete from expenses where id = r.expense_id;
    else
      c := r.changes;
      update expenses set
        amount       = case when c ? 'amount' then (c ->> 'amount')::numeric else amount end,
        description  = case when c ? 'description' then c ->> 'description' else description end,
        category_id  = case when c ? 'category_id' then (c ->> 'category_id')::uuid else category_id end,
        expense_date = case when c ? 'expense_date' then (c ->> 'expense_date')::date else expense_date end,
        paid_by      = case when c ? 'paid_by' then (c ->> 'paid_by')::uuid else paid_by end,
        note         = case when c ? 'note' then c ->> 'note' else note end
      where id = r.expense_id;
    end if;
  end if;

  update change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = r.id;
end
$$;

revoke all on function public.check_requested_changes(uuid, jsonb) from public, anon, authenticated;
revoke all on function
  public.request_expense_change(uuid, text, jsonb, text),
  public.cancel_change_request(uuid),
  public.decide_change_request(uuid, boolean, text)
  from public, anon;
grant execute on function
  public.request_expense_change(uuid, text, jsonb, text),
  public.cancel_change_request(uuid),
  public.decide_change_request(uuid, boolean, text)
  to authenticated;

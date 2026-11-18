-- Settlement engine and RPCs. All money maths in integer paise so totals balance exactly.

-- Internal: compute the settlement for one month. Not callable by clients (see grants).
-- Participants = Owner/Member rows active at any point in the month (current role is used).
-- Equal split; the paise left over after integer division go one each to the
-- earliest-joined participants, so shares always add up to the exact total.
create or replace function public.compute_settlement(p_household uuid, p_year int, p_month int)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_start  date := make_date(p_year, p_month, 1);
  v_end    date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_total  bigint;
  v_n      int;
  v_base   bigint;
  v_rem    bigint;
  v_people jsonb;
  v_transfers jsonb := '[]'::jsonb;
  d_ids uuid[];  d_amt bigint[];
  c_ids uuid[];  c_amt bigint[];
  i int := 1;  j int := 1;
  v_pay bigint;
  v_fallback boolean := false;
  v_founding date;
begin
  select coalesce(sum((amount * 100)::bigint), 0) into v_total
  from expenses
  where household_id = p_household and expense_date >= v_start and expense_date < v_end;

  select count(distinct user_id) into v_n
  from household_members
  where household_id = p_household
    and role in ('owner', 'member')
    and (joined_at at time zone 'Asia/Kolkata')::date < v_end
    and (removed_at is null or (removed_at at time zone 'Asia/Kolkata')::date >= v_start);

  -- Expenses backdated to before anyone joined: split among the founding Owner/Members
  -- (those who joined in the household's first month), never people who joined later.
  if v_n = 0 then
    v_fallback := true;
    select date_trunc('month', min(joined_at) at time zone 'Asia/Kolkata')::date into v_founding
    from household_members where household_id = p_household;
    select count(distinct user_id) into v_n
    from household_members
    where household_id = p_household and role in ('owner', 'member')
      and date_trunc('month', joined_at at time zone 'Asia/Kolkata')::date = v_founding;
  end if;

  v_base := case when v_n > 0 then v_total / v_n else 0 end;
  v_rem  := case when v_n > 0 then v_total % v_n else 0 end;

  with participants as (
    select user_id, row_number() over (order by min(joined_at), user_id) as rn
    from household_members
    where household_id = p_household
      and role in ('owner', 'member')
      and case when v_fallback then date_trunc('month', joined_at at time zone 'Asia/Kolkata')::date = v_founding
               else (joined_at at time zone 'Asia/Kolkata')::date < v_end
                    and (removed_at is null or (removed_at at time zone 'Asia/Kolkata')::date >= v_start)
          end
    group by user_id
  ),
  paid as (
    select paid_by as user_id, sum((amount * 100)::bigint) as paise
    from expenses
    where household_id = p_household and expense_date >= v_start and expense_date < v_end
    group by paid_by
  ),
  people as (
    select u.user_id,
           pr.display_name,
           coalesce(pd.paise, 0) as paid,
           case when pt.rn is null then 0
                when pt.rn <= v_rem then v_base + 1
                else v_base end as share,
           pt.rn is not null as is_participant,
           coalesce(pt.rn, 1000000) as ord
    from (select user_id from participants union select user_id from paid) u
    join profiles pr on pr.id = u.user_id
    left join participants pt on pt.user_id = u.user_id
    left join paid pd on pd.user_id = u.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', user_id,
           'display_name', display_name,
           'paid_paise', paid,
           'share_paise', share,
           'balance_paise', paid - share,
           'is_participant', is_participant
         ) order by ord, display_name), '[]'::jsonb)
  into v_people
  from people;

  -- Greedy match: largest debtor pays largest creditor. Gives at most (people - 1)
  -- payments, and exactly one payment for a two-person household.
  select coalesce(array_agg(uid order by amt desc, uid), '{}'), coalesce(array_agg(amt order by amt desc, uid), '{}')
  into d_ids, d_amt
  from (select (e ->> 'user_id')::uuid as uid, -(e ->> 'balance_paise')::bigint as amt
        from jsonb_array_elements(v_people) e where (e ->> 'balance_paise')::bigint < 0) s;

  select coalesce(array_agg(uid order by amt desc, uid), '{}'), coalesce(array_agg(amt order by amt desc, uid), '{}')
  into c_ids, c_amt
  from (select (e ->> 'user_id')::uuid as uid, (e ->> 'balance_paise')::bigint as amt
        from jsonb_array_elements(v_people) e where (e ->> 'balance_paise')::bigint > 0) s;

  while i <= coalesce(array_length(d_ids, 1), 0) and j <= coalesce(array_length(c_ids, 1), 0) loop
    v_pay := least(d_amt[i], c_amt[j]);
    v_transfers := v_transfers || jsonb_build_array(
      jsonb_build_object('from', d_ids[i], 'to', c_ids[j], 'amount_paise', v_pay));
    d_amt[i] := d_amt[i] - v_pay;
    c_amt[j] := c_amt[j] - v_pay;
    if d_amt[i] = 0 then i := i + 1; end if;
    if c_amt[j] = 0 then j := j + 1; end if;
  end loop;

  return jsonb_build_object(
    'year', p_year,
    'month', p_month,
    'total_paise', v_total,
    'participant_count', v_n,
    'people', v_people,
    'transfers', v_transfers,
    'computed_at', now()
  );
end
$$;

-- Month summary for the dashboard and settlement page. Closed months return the frozen snapshot.
-- Reopened months show live figures plus the payments recorded at the last close (their marks are kept).
create or replace function public.get_month_summary(p_household uuid, p_year int, p_month int)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_c        month_closures%rowtype;
  v_first    date := make_date(p_year, p_month, 1);
  v_this     date := date_trunc('month', ist_today())::date;
  v_payments jsonb;
  v_result   jsonb;
begin
  if not is_household_member(p_household) then
    raise exception 'You are not a member of this household.' using errcode = '42501';
  end if;

  select * into v_c from month_closures
  where household_id = p_household and year = p_year and month = p_month;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'from', from_user, 'to', to_user,
           'amount_paise', (amount * 100)::bigint,
           'paid_amount_paise', (paid_amount * 100)::bigint,
           'paid_on', paid_on, 'marked_by', marked_by, 'marked_at', marked_at
         ) order by amount desc, id), '[]'::jsonb)
  into v_payments
  from settlement_payments
  where household_id = p_household and year = p_year and month = p_month;

  if v_c.status = 'closed' then
    v_result := v_c.snapshot || jsonb_build_object(
      'status', 'closed', 'closed_at', v_c.closed_at, 'closed_by', v_c.closed_by);
  else
    v_result := compute_settlement(p_household, p_year, p_month) || jsonb_build_object(
      'status', coalesce(v_c.status, 'open'), 'reopened_at', v_c.reopened_at);
  end if;

  return v_result || jsonb_build_object(
    'payments', v_payments, 'is_past', v_first < v_this, 'is_current', v_first = v_this);
end
$$;

-- Internal: freeze a month's settlement and (re)build its payment rows.
-- Paid marks from an earlier close are carried over to the same payer -> receiver pair, keeping the
-- amount actually paid. A paid pair that is no longer owed stays as a row with amount 0.
create or replace function public.close_month_internal(p_household uuid, p_year int, p_month int, p_by uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snap jsonb := compute_settlement(p_household, p_year, p_month);
begin
  insert into month_closures (household_id, year, month, status, snapshot, closed_at, closed_by)
  values (p_household, p_year, p_month, 'closed', v_snap, now(), p_by)
  on conflict (household_id, year, month) do update
    set status = 'closed', snapshot = excluded.snapshot, closed_at = now(), closed_by = excluded.closed_by;

  with old as (
    delete from settlement_payments
    where household_id = p_household and year = p_year and month = p_month
    returning from_user, to_user, paid_on, paid_amount, marked_by, marked_at
  ),
  paid as (select * from old where paid_on is not null),
  fresh as (
    select (t ->> 'from')::uuid as from_user, (t ->> 'to')::uuid as to_user,
           ((t ->> 'amount_paise')::bigint / 100.0)::numeric(12, 2) as amount
    from jsonb_array_elements(v_snap -> 'transfers') t
  )
  insert into settlement_payments
    (household_id, year, month, from_user, to_user, amount, paid_on, paid_amount, marked_by, marked_at)
  select p_household, p_year, p_month,
         coalesce(f.from_user, p.from_user), coalesce(f.to_user, p.to_user), coalesce(f.amount, 0),
         p.paid_on, p.paid_amount, p.marked_by, p.marked_at
  from fresh f
  full join paid p on p.from_user = f.from_user and p.to_user = f.to_user;
end
$$;

-- Only the Owner closes months (there is no scheduled job), and only once the month has ended.
create or replace function public.close_month(p_household uuid, p_year int, p_month int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_household_owner(p_household) then
    raise exception 'Only the Owner can close a month.' using errcode = '42501';
  end if;
  if make_date(p_year, p_month, 1) >= date_trunc('month', ist_today())::date then
    raise exception 'A month can be closed once it has ended.' using errcode = 'P0001';
  end if;
  if exists (select 1 from month_closures where household_id = p_household
             and year = p_year and month = p_month and status = 'closed') then
    raise exception 'This month is already closed.' using errcode = 'P0001';
  end if;
  perform close_month_internal(p_household, p_year, p_month, auth.uid());
end
$$;

-- Reopening unlocks the month's expenses. Payment rows and their Paid marks are kept.
create or replace function public.reopen_month(p_household uuid, p_year int, p_month int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_household_owner(p_household) then
    raise exception 'Only the Owner can reopen a month.' using errcode = '42501';
  end if;
  update month_closures
     set status = 'reopened', reopened_at = now(), reopened_by = auth.uid()
   where household_id = p_household and year = p_year and month = p_month and status = 'closed';
  if not found then
    raise exception 'This month is not closed.' using errcode = 'P0001';
  end if;
end
$$;

-- Mark a payment as paid in full on a date (or clear the mark with p_paid_on = null).
create or replace function public.mark_payment(p_payment uuid, p_paid_on date) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p settlement_payments%rowtype;
begin
  select * into v_p from settlement_payments where id = p_payment;
  if not found or not is_household_member(v_p.household_id) then
    raise exception 'Payment not found.' using errcode = 'P0002';
  end if;
  if auth.uid() not in (v_p.from_user, v_p.to_user) and not is_household_owner(v_p.household_id) then
    raise exception 'Only the payer, the receiver or the Owner can update this payment.' using errcode = '42501';
  end if;
  if p_paid_on is not null and v_p.amount = 0 then
    raise exception 'Nothing is owed on this payment any more.' using errcode = 'P0001';
  end if;
  if p_paid_on is not null and (p_paid_on < make_date(v_p.year, v_p.month, 1) or p_paid_on > ist_today()) then
    raise exception 'Paid date must be between the start of that month and today.' using errcode = '23514';
  end if;
  update settlement_payments
     set paid_on     = p_paid_on,
         paid_amount = case when p_paid_on is null then null else amount end,
         marked_by   = case when p_paid_on is null then null else auth.uid() end,
         marked_at   = case when p_paid_on is null then null else now() end
   where id = p_payment;
end
$$;

-- Household setup and access management.
create or replace function public.create_household(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from household_members where user_id = auth.uid() and removed_at is null) then
    raise exception 'You already belong to a household.' using errcode = 'P0001';
  end if;

  insert into households (name, created_by) values (btrim(p_name), auth.uid()) returning id into v_id;
  insert into household_members (household_id, user_id, role) values (v_id, auth.uid(), 'owner');
  insert into categories (household_id, name, sort_order)
  select v_id, name, ord
  from unnest(array['Groceries', 'Rent', 'Utilities', 'Internet & Mobile', 'Household Supplies',
                    'Dining & Takeaway', 'Transport', 'Maintenance & Repairs', 'Other'])
       with ordinality as t(name, ord);
  return v_id;
end
$$;

-- Owner creates a single-use invite link and shares it themselves. Returns the token.
create or replace function public.create_invite(p_household uuid, p_role text, p_label text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token text;
begin
  if not is_household_owner(p_household) then
    raise exception 'Only the Owner can create invite links.' using errcode = '42501';
  end if;
  if p_role not in ('member', 'viewer') then
    raise exception 'Role must be Member or Viewer.' using errcode = '23514';
  end if;
  insert into household_invites (household_id, role, label, invited_by)
  values (p_household, p_role, nullif(btrim(coalesce(p_label, '')), ''), auth.uid())
  returning token into v_token;
  return v_token;
end
$$;

create or replace function public.cancel_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update household_invites set status = 'cancelled', responded_at = now()
   where id = p_invite and status = 'pending' and is_household_owner(household_id);
  if not found then
    raise exception 'Invite not found or already used.' using errcode = 'P0002';
  end if;
end
$$;

-- What an invite link points to, for the person who opened it. Reveals only the household name,
-- role and inviter, and only to someone holding the token.
create or replace function public.get_invite(p_token text)
returns table (household_name text, role text, invited_by_name text, state text)
language sql stable security definer set search_path = public as $$
  select h.name, i.role, p.display_name,
         case when i.status <> 'pending' then i.status
              when i.expires_at < now() then 'expired'
              else 'valid' end
  from household_invites i
  join households h on h.id = i.household_id
  join profiles p on p.id = i.invited_by
  where i.token = p_token and auth.uid() is not null
$$;

create or replace function public.accept_invite(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inv household_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select * into v_inv from household_invites where token = p_token for update;
  if not found or v_inv.status = 'cancelled' then
    raise exception 'This invite link is not valid. Ask the Owner for a new one.' using errcode = 'P0002';
  end if;
  if v_inv.status = 'accepted' then
    raise exception 'This invite link has already been used. Ask the Owner for a new one.' using errcode = 'P0001';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'This invite link has expired. Ask the Owner for a new one.' using errcode = 'P0001';
  end if;
  if exists (select 1 from household_members where user_id = auth.uid() and removed_at is null) then
    raise exception 'You already belong to a household. Leave it before joining another.' using errcode = 'P0001';
  end if;

  insert into household_members (household_id, user_id, role) values (v_inv.household_id, auth.uid(), v_inv.role);
  update household_invites
     set status = 'accepted', accepted_by = auth.uid(), responded_at = now()
   where id = v_inv.id;
end
$$;

create or replace function public.change_member_role(p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_m household_members%rowtype;
begin
  select * into v_m from household_members where id = p_member and removed_at is null;
  if not found or not is_household_owner(v_m.household_id) then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  if v_m.role = 'owner' then
    raise exception 'The Owner''s role cannot be changed.' using errcode = 'P0001';
  end if;
  if p_role not in ('member', 'viewer') then
    raise exception 'Role must be Member or Viewer.' using errcode = '23514';
  end if;
  update household_members set role = p_role where id = p_member;
end
$$;

create or replace function public.remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_m household_members%rowtype;
begin
  select * into v_m from household_members where id = p_member and removed_at is null;
  if not found or not is_household_owner(v_m.household_id) then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  if v_m.role = 'owner' then
    raise exception 'The Owner cannot be removed.' using errcode = 'P0001';
  end if;
  update household_members set removed_at = now() where id = p_member;
end
$$;

create or replace function public.leave_household() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from household_members where user_id = auth.uid() and removed_at is null and role = 'owner') then
    raise exception 'The Owner cannot leave the household.' using errcode = 'P0001';
  end if;
  update household_members set removed_at = now() where user_id = auth.uid() and removed_at is null;
end
$$;

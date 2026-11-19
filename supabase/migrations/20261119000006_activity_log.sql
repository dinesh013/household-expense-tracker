-- Household activity log (2026-11-19): who added, edited or deleted which expense, and when.
-- Applied on top of 0001–0005, which are already live: run this file once in the Supabase SQL Editor.
--
-- Builds on expense_history (one row per add/edit) instead of a second table:
--   * deletions are now recorded too, and the history of a deleted expense is kept;
--   * every entry stores a snapshot of the expense (amount, date, payer, ...) as it was at that moment,
--     so the log can show "how much, for which date" even after later edits or a delete.
-- Readable by every member of the household (existing policy history_select); nobody can write to it directly.

-- 1. Keep history when an expense is deleted (it used to cascade away), and allow a 'deleted' entry.
alter table public.expense_history drop constraint if exists expense_history_expense_id_fkey;
alter table public.expense_history drop constraint if exists expense_history_action_check;
alter table public.expense_history
  add constraint expense_history_action_check check (action in ('created', 'updated', 'deleted'));

-- 2. The expense as it was right after this entry (for 'deleted': as it was when deleted).
alter table public.expense_history add column if not exists snapshot jsonb;

-- 3. Exact order of entries (several can share a timestamp, e.g. one save of many expenses).
--    Existing rows are numbered in the order they were written.
alter table public.expense_history add column if not exists seq bigint generated always as identity;

create index if not exists expense_history_household_seq
  on public.expense_history (household_id, seq desc);

-- 4. Record history for inserts, updates and deletes, with a snapshot each time.
create or replace function public.expense_snapshot(e public.expenses) returns jsonb
language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'amount', e.amount, 'description', e.description, 'category_id', e.category_id,
    'expense_date', e.expense_date, 'paid_by', e.paid_by, 'note', e.note)
$$;

create or replace function public.expenses_record_history() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into expense_history (expense_id, household_id, action, changed_by, snapshot)
    values (new.id, new.household_id, 'created', new.logged_by, expense_snapshot(new));
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Skip when the whole household is being deleted (its history goes with it).
    if exists (select 1 from households where id = old.household_id) then
      insert into expense_history (expense_id, household_id, action, changed_by, snapshot)
      values (old.id, old.household_id, 'deleted', auth.uid(), expense_snapshot(old));
    end if;
    return old;
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
    insert into expense_history (expense_id, household_id, action, changed_by, changes, snapshot)
    values (new.id, new.household_id, 'updated', auth.uid(), v_changes, expense_snapshot(new));
  end if;
  return new;
end
$$;

drop trigger if exists expenses_record_history on public.expenses;
create trigger expenses_record_history
  after insert or update or delete on public.expenses
  for each row execute function public.expenses_record_history();

-- 5. Backfill snapshots for entries written before this migration.
-- A field's value just after entry h = the "from" of the next edit (by seq) that changed it, else its current value.
create or replace function public.tmp_history_field(p_expense uuid, p_after bigint, p_all boolean, p_field text, p_current jsonb)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(
    (select u.changes -> p_field -> 'from' from expense_history u
      where u.expense_id = p_expense and u.action = 'updated' and u.changes ? p_field
        and (p_all or u.seq > p_after)
      order by u.seq limit 1),
    p_current)
$$;

update public.expense_history h
set snapshot = (
  select jsonb_object_agg(f.key, public.tmp_history_field(h.expense_id, h.seq, h.action = 'created', f.key, f.value))
  from jsonb_each(public.expense_snapshot(e)) f)
from public.expenses e
where e.id = h.expense_id and h.snapshot is null;

drop function public.tmp_history_field(uuid, bigint, boolean, text, jsonb);

-- Internal helper: not callable from the client.
revoke all on function public.expense_snapshot(public.expenses) from public, anon, authenticated;

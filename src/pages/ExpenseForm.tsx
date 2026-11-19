import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { errorText, must, rpc } from '../lib/api';
import { activePayers, useApp } from '../lib/session';
import { compareMonths, currentMonth, dateTimeLabel, formatRupees, istToday, monthKey, shortDate, validateExpense, type ExpenseInput } from '../lib/format';
import type { Expense, HistoryEntry } from '../lib/types';
import { Icon, Spinner, useToast } from '../components/ui';

import { LAST_CATEGORY_KEY } from '../lib/expenseRows';

export default function ExpenseForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { household, profile, members, categories, canWrite, nameOf, revalidate } = useApp();
  const today = istToday();

  const [loading, setLoading] = useState(Boolean(id));
  const [original, setOriginal] = useState<Expense | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof ExpenseInput, string>>>({});

  const payers = activePayers(members);
  const selfIsPayer = payers.some((m) => m.user_id === profile?.id);
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') && params.get('date')! <= today ? params.get('date')! : today;
  const lastCat = localStorage.getItem(LAST_CATEGORY_KEY);

  const [form, setForm] = useState<ExpenseInput>({
    amount: '',
    description: '',
    categoryId: categories.find((c) => c.id === lastCat)?.id ?? categories[0]?.id ?? '',
    date: initialDate,
    paidBy: selfIsPayer ? profile!.id : payers[0]?.user_id ?? '',
    note: '',
  });
  const set = (k: keyof ExpenseInput) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  // Make sure someone who joined since the app loaded is offered under "Paid by".
  useEffect(() => { revalidate(); }, [revalidate]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const e = await must(supabase.from('expenses').select('*').eq('id', id).maybeSingle());
        if (!e) { setError('This expense no longer exists.'); return; }
        const exp = e as Expense;
        const [h, isLocked] = await Promise.all([
          must(supabase.from('expense_history').select('id, action, changed_by, changed_at, changes').eq('expense_id', id).order('seq', { ascending: false })),
          rpc<boolean>('is_month_locked', { p_household: exp.household_id, p_date: exp.expense_date }),
        ]);
        setOriginal(exp);
        setHistory(h as HistoryEntry[]);
        setLocked(isLocked);
        setForm({
          amount: Number(exp.amount).toFixed(2),
          description: exp.description,
          categoryId: exp.category_id,
          date: exp.expense_date,
          paidBy: exp.paid_by,
          note: exp.note ?? '',
        });
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const readOnly = !canWrite || locked;
  const backTo = useMemo(() => {
    const ym = { year: Number(form.date.slice(0, 4)), month: Number(form.date.slice(5, 7)) };
    return form.date && compareMonths(ym, currentMonth()) !== 0 ? `/?m=${monthKey(ym)}` : '/';
  }, [form.date]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validateExpense(form, today);
    if (!v.ok) {
      setErrors(v.errors ?? {});
      setError(v.error);
      return;
    }
    setBusy(true);
    try {
      if (original) {
        await must(supabase.from('expenses').update(v.value).eq('id', original.id));
        toast('Expense updated');
      } else {
        await must(supabase.from('expenses').insert({ ...v.value, household_id: household!.id }));
        toast('Expense added');
      }
      localStorage.setItem(LAST_CATEGORY_KEY, v.value.category_id);
      navigate(backTo);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!original || !confirm(`Delete "${original.description}" (${formatRupees(original.amount)})? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await must(supabase.from('expenses').delete().eq('id', original.id));
      toast('Expense deleted');
      navigate(backTo);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  const payerOptions = original && !payers.some((m) => m.user_id === original.paid_by)
    ? [...payers.map((m) => ({ id: m.user_id, name: m.profile?.display_name ?? '' })), { id: original.paid_by, name: nameOf(original.paid_by) }]
    : payers.map((m) => ({ id: m.user_id, name: m.profile?.display_name ?? '' }));

  return (
    <>
      <div className="page-head">
        <Link to={backTo} className="icon-btn" aria-label="Back">{Icon.back}</Link>
        <h1>{original ? (readOnly ? 'Expense' : 'Edit expense') : 'Add expense'}</h1>
      </div>

      {locked && <div className="alert warn">This month is closed, so the expense is locked. The Owner can reopen the month from the Settlement page.</div>}
      {!canWrite && <div className="alert info">You have view-only access.</div>}
      {error && <div className="alert error" role="alert">{error}</div>}

      <form className="card form-grid" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="amount">Amount</label>
          <div className="amount-input">
            <span aria-hidden="true">₹</span>
            <input id="amount" className={`input num${errors.amount ? ' invalid' : ''}`} inputMode="decimal" autoComplete="off" placeholder="0.00"
              value={form.amount} onChange={(e) => set('amount')(e.target.value)} disabled={readOnly} autoFocus={!original}
              aria-invalid={Boolean(errors.amount)} aria-describedby={errors.amount ? 'amount-err' : undefined} required />
          </div>
          {errors.amount && <span id="amount-err" className="field-error">{errors.amount}</span>}
        </div>

        <div className="field">
          <label htmlFor="desc">Description</label>
          <input id="desc" className={`input${errors.description ? ' invalid' : ''}`} placeholder="e.g. Weekly vegetables" maxLength={120}
            value={form.description} onChange={(e) => set('description')(e.target.value)} disabled={readOnly}
            aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? 'desc-err' : undefined} required />
          {errors.description && <span id="desc-err" className="field-error">{errors.description}</span>}
        </div>

        <div className="form-grid two">
          <div className="field">
            <label htmlFor="cat">Category</label>
            <select id="cat" className={`input${errors.categoryId ? ' invalid' : ''}`} value={form.categoryId} onChange={(e) => set('categoryId')(e.target.value)} disabled={readOnly}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {errors.categoryId && <span className="field-error">{errors.categoryId}</span>}
          </div>
          <div className="field">
            <label htmlFor="date">Date</label>
            <input id="date" type="date" className={`input${errors.date ? ' invalid' : ''}`} max={today} value={form.date}
              onChange={(e) => set('date')(e.target.value)} disabled={readOnly} aria-invalid={Boolean(errors.date)} />
            {errors.date && <span className="field-error">{errors.date}</span>}
          </div>
        </div>

        <div className="field">
          <label htmlFor="paidby">Paid by</label>
          <select id="paidby" className={`input${errors.paidBy ? ' invalid' : ''}`} value={form.paidBy} onChange={(e) => set('paidBy')(e.target.value)} disabled={readOnly}>
            {payerOptions.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === profile?.id ? ' (you)' : ''}</option>)}
          </select>
          {errors.paidBy && <span className="field-error">{errors.paidBy}</span>}
        </div>

        <div className="field">
          <label htmlFor="note">Note <span className="muted">(optional)</span></label>
          <textarea id="note" className="input" maxLength={500} value={form.note} onChange={(e) => set('note')(e.target.value)} disabled={readOnly} />
          {errors.note && <span className="field-error">{errors.note}</span>}
        </div>

        {original && (
          <p className="small muted">
            Logged by <strong>{nameOf(original.logged_by)}</strong> on {dateTimeLabel(original.created_at)} · Paid by <strong>{nameOf(original.paid_by)}</strong>
          </p>
        )}

        {!readOnly && (
          <div className="row wrap">
            <button className="btn" disabled={busy}>{busy ? 'Saving…' : original ? 'Save changes' : 'Add expense'}</button>
            <Link to={backTo} className="btn ghost">Cancel</Link>
            <span className="spacer" />
            {original && <button type="button" className="btn danger-ghost" disabled={busy} onClick={remove}>Delete</button>}
          </div>
        )}
      </form>

      {original && <History entries={history} />}
    </>
  );
}

function History({ entries }: { entries: HistoryEntry[] }) {
  const { nameOf, categories } = useApp();
  const fmt = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'amount') return formatRupees(v as number);
    if (field === 'category_id') return categories.find((c) => c.id === v)?.name ?? 'a removed category';
    if (field === 'paid_by') return nameOf(v as string);
    if (field === 'expense_date') return shortDate(v as string);
    return `“${String(v)}”`;
  };
  const LABEL: Record<string, string> = { amount: 'amount', description: 'description', category_id: 'category', expense_date: 'date', paid_by: 'paid by', note: 'note' };

  return (
    <section className="card" aria-labelledby="hist-h">
      <div className="card-head"><h2 id="hist-h">Edit history</h2></div>
      <ul className="timeline">
        {entries.map((h) => (
          <li key={h.id}>
            <div className="when">{dateTimeLabel(h.changed_at)}</div>
            {h.action === 'created' ? (
              <div><strong>{nameOf(h.changed_by)}</strong> added this expense</div>
            ) : (
              <div>
                <strong>{nameOf(h.changed_by)}</strong> changed{' '}
                {Object.entries(h.changes).map(([field, c], i, arr) => (
                  <span key={field}>
                    {LABEL[field] ?? field} from {fmt(field, c.from)} to {fmt(field, c.to)}{i < arr.length - 1 ? '; ' : ''}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

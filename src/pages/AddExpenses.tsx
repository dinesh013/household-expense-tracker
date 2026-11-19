import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { errorText, must } from '../lib/api';
import { activePayers, useApp } from '../lib/session';
import { compareMonths, currentMonth, formatPaise, istToday, monthKey, type ExpenseInput } from '../lib/format';
import { blankRow, LAST_CATEGORY_KEY, MAX_ROWS, rowAfter, rowsTotalPaise, validateRows, type Row, type RowErrors } from '../lib/expenseRows';
import { Icon, useToast } from '../components/ui';

/** Add one expense, or several in one save (e.g. a whole shopping trip). Owner and Members only. */
export default function AddExpenses() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { household, profile, members, categories, canWrite, revalidate } = useApp();
  const today = istToday();

  const payers = activePayers(members);
  const selfIsPayer = payers.some((m) => m.user_id === profile?.id);
  const dateParam = params.get('date') ?? '';
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam <= today ? dateParam : today;
  const lastCat = localStorage.getItem(LAST_CATEGORY_KEY);

  const [rows, setRows] = useState<Row[]>(() => [blankRow({
    categoryId: categories.find((c) => c.id === lastCat)?.id ?? categories[0]?.id ?? '',
    date: initialDate,
    paidBy: selfIsPayer ? profile!.id : payers[0]?.user_id ?? '',
  })]);
  const [errors, setErrors] = useState<RowErrors[]>([{}]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const focusKey = useRef<number | null>(null);

  // Make sure someone who joined since the app loaded is offered under "Paid by".
  useEffect(() => { revalidate(); }, [revalidate]);

  // Put the cursor in the amount of a row that was just added.
  useEffect(() => {
    if (focusKey.current === null) return;
    const input = document.getElementById(`amount-${focusKey.current}`);
    // Centre the new row so the sticky Save bar doesn't cover it, then put the cursor in it.
    input?.closest('section')?.scrollIntoView({ block: 'center' });
    input?.focus({ preventScroll: true });
    focusKey.current = null;
  }, [rows.length]);

  const backTo = useMemo(() => {
    const d = rows[0].date;
    const ym = { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) };
    return /^\d{4}-\d{2}/.test(d) && compareMonths(ym, currentMonth()) !== 0 ? `/?m=${monthKey(ym)}` : '/';
  }, [rows]);

  const update = (i: number, k: keyof ExpenseInput, v: string) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    setErrors((es) => es.map((e, j) => (j === i ? { ...e, [k]: undefined } : e)));
  };

  function addRow() {
    if (rows.length >= MAX_ROWS) return;
    const next = rowAfter(rows[rows.length - 1]);
    focusKey.current = next.key;
    setRows((rs) => [...rs, next]);
    setErrors((es) => [...es, {}]);
  }

  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, j) => j !== i));
    setErrors((es) => es.filter((_, j) => j !== i));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validateRows(rows, today);
    setErrors(v.errors);
    if (!v.ok) {
      setError(v.error);
      // On a long list the message is off-screen: take the person to the first field to fix.
      const i = v.errors.findIndex((e) => Object.keys(e).length > 0);
      const field = i >= 0 ? (Object.keys(v.errors[i])[0] as keyof ExpenseInput) : null;
      if (field) document.getElementById(`${field}-${rows[i].key}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      // One request: the database saves every row or none of them.
      await must(supabase.from('expenses').insert(v.values.map((x) => ({ ...x, household_id: household!.id }))));
      localStorage.setItem(LAST_CATEGORY_KEY, v.values[v.values.length - 1].category_id);
      toast(v.values.length === 1 ? 'Expense added' : `${v.values.length} expenses added`);
      navigate(backTo);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const total = rowsTotalPaise(rows);
  const filledCount = rows.filter((r) => r.amount.trim() || r.description.trim()).length;
  const many = rows.length > 1;

  return (
    <>
      <div className="page-head">
        <Link to={backTo} className="icon-btn" aria-label="Back">{Icon.back}</Link>
        <h1>{many ? 'Add expenses' : 'Add expense'}</h1>
      </div>

      {!canWrite ? (
        <div className="alert info">You have view-only access.</div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {error && <div className="alert error" role="alert">{error}</div>}

          {rows.map((r, i) => (
            <RowCard key={r.key} row={r} index={i} many={many} errors={errors[i] ?? {}} today={today}
              payers={payers.map((m) => ({ id: m.user_id, name: m.profile?.display_name ?? '' }))}
              onChange={(k, v) => update(i, k, v)} onRemove={() => removeRow(i)} autoFocus={i === 0} />
          ))}

          {rows.length < MAX_ROWS ? (
            <button type="button" className="btn secondary block" onClick={addRow}>{Icon.plus} Add another expense</button>
          ) : (
            <p className="small muted">You can add up to {MAX_ROWS} expenses at a time.</p>
          )}

          <div className="card add-footer">
            {many && (
              <div className="row small">
                <span className="muted">{filledCount === 0 ? 'Nothing filled in yet' : `${filledCount} ${filledCount === 1 ? 'expense' : 'expenses'}`}</span>
                <span className="spacer" />
                <span>Total <strong className="num">{formatPaise(total)}</strong></span>
              </div>
            )}
            <div className="row wrap">
              <button className="btn" disabled={busy}>
                {busy ? 'Saving…' : !many ? 'Add expense' : filledCount === 0 ? 'Save expenses' : `Save ${filledCount} ${filledCount === 1 ? 'expense' : 'expenses'}`}
              </button>
              <Link to={backTo} className="btn ghost">Cancel</Link>
            </div>
          </div>
        </form>
      )}
    </>
  );
}

function RowCard({ row, index, many, errors, today, payers, onChange, onRemove, autoFocus }: {
  row: Row; index: number; many: boolean; errors: RowErrors; today: string;
  payers: { id: string; name: string }[];
  onChange: (k: keyof ExpenseInput, v: string) => void; onRemove: () => void; autoFocus: boolean;
}) {
  const { categories, profile } = useApp();
  const [showNote, setShowNote] = useState(Boolean(row.note));
  const id = (f: string) => `${f}-${row.key}`;
  const err = (f: keyof ExpenseInput) => errors[f] && <span id={id(`${f}-err`)} className="field-error">{errors[f]}</span>;
  const aria = (f: keyof ExpenseInput) => ({ 'aria-invalid': Boolean(errors[f]), 'aria-describedby': errors[f] ? id(`${f}-err`) : undefined });

  return (
    <section className="card form-grid" aria-label={many ? `Expense ${index + 1}` : 'Expense'}>
      {many && (
        <div className="card-head">
          <h2>Expense {index + 1}</h2>
          <button type="button" className="icon-btn sm" onClick={onRemove} aria-label={`Remove expense ${index + 1}`}>{Icon.close}</button>
        </div>
      )}
      <div className={many ? 'form-grid two' : 'form-grid'}>
        <div className="field">
          <label htmlFor={id('amount')}>Amount</label>
          <div className={`amount-input${many ? ' compact' : ''}`}>
            <span aria-hidden="true">₹</span>
            <input id={id('amount')} className={`input num${errors.amount ? ' invalid' : ''}`} inputMode="decimal" autoComplete="off" placeholder="0.00"
              value={row.amount} onChange={(e) => onChange('amount', e.target.value)} autoFocus={autoFocus} required {...aria('amount')} />
          </div>
          {err('amount')}
        </div>
        <div className="field">
          <label htmlFor={id('description')}>Description</label>
          <input id={id('description')} className={`input${errors.description ? ' invalid' : ''}`} placeholder="e.g. Weekly vegetables" maxLength={120}
            value={row.description} onChange={(e) => onChange('description', e.target.value)} required {...aria('description')} />
          {err('description')}
        </div>
      </div>

      <div className="form-grid two">
        <div className="field">
          <label htmlFor={id('categoryId')}>Category</label>
          <select id={id('categoryId')} className={`input${errors.categoryId ? ' invalid' : ''}`} value={row.categoryId} onChange={(e) => onChange('categoryId', e.target.value)} {...aria('categoryId')}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {err('categoryId')}
        </div>
        <div className="field">
          <label htmlFor={id('date')}>Date</label>
          <input id={id('date')} type="date" className={`input${errors.date ? ' invalid' : ''}`} max={today} value={row.date}
            onChange={(e) => onChange('date', e.target.value)} {...aria('date')} />
          {err('date')}
        </div>
      </div>

      <div className="field">
        <label htmlFor={id('paidBy')}>Paid by</label>
        <select id={id('paidBy')} className={`input${errors.paidBy ? ' invalid' : ''}`} value={row.paidBy} onChange={(e) => onChange('paidBy', e.target.value)} {...aria('paidBy')}>
          {payers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === profile?.id ? ' (you)' : ''}</option>)}
        </select>
        {err('paidBy')}
      </div>

      {showNote ? (
        <div className="field">
          <label htmlFor={id('note')}>Note <span className="muted">(optional)</span></label>
          <textarea id={id('note')} className="input" maxLength={500} value={row.note} onChange={(e) => onChange('note', e.target.value)} autoFocus={!row.note} />
          {err('note')}
        </div>
      ) : (
        <div><button type="button" className="btn ghost sm" onClick={() => setShowNote(true)}>+ Add a note</button></div>
      )}
    </section>
  );
}

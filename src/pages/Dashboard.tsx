import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../lib/session';
import { hasUnknownPeople, payerFilterOptions } from '../lib/members';
import { useMonthData, useSelectedMonth } from '../lib/useMonth';
import { dayLabel, formatPaise, istToday, monthKey, monthLabel, toPaise } from '../lib/format';
import type { Expense, MonthSummary, Payment } from '../lib/types';
import { isSettled } from '../lib/settlement';
import { categoryColour, EmptyState, Icon, MonthSwitcher, Spinner, StatusBadge, initials } from '../components/ui';
import { CategoryDonut, TransferLine, type Slice } from '../components/charts';

export default function Dashboard() {
  const app = useApp();
  const ym = useSelectedMonth();
  const { summary, expenses, loading, error } = useMonthData(app.household!.id, ym);
  const { members, revalidate } = app;

  // Pick up people who joined since the list was loaded: on every visit, and straight away when an
  // expense names someone the list doesn't have yet.
  useEffect(() => { revalidate(); }, [revalidate]);
  useEffect(() => {
    if (hasUnknownPeople(members, expenses)) revalidate();
  }, [members, expenses, revalidate]);

  const locked = summary?.status === 'closed';
  const newHref = summary && !summary.is_current ? `/expenses/new?date=${lastDayOf(ym)}` : '/expenses/new';

  return (
    <>
      <MonthSwitcher value={ym} basePath="/" badge={summary && <StatusBadge status={summary.status} isCurrent={summary.is_current} />} />
      {error && <div className="alert error" role="alert">{error}</div>}
      {loading || !summary ? <Spinner /> : (
        <>
          <SummaryCards summary={summary} />
          <SettlementCard summary={summary} ymKey={monthKey(ym)} />
          {expenses.length > 0 && <BreakdownCard expenses={expenses} />}
          <ExpenseList expenses={expenses} monthName={monthLabel(ym)} isCurrent={summary.is_current} canAdd={app.canWrite && !locked} />
        </>
      )}
      {app.canWrite && !locked && summary && (
        <>
          {/* Room to scroll the last expense clear of the floating button. */}
          <div className="fab-spacer" aria-hidden="true" />
          <Link className="fab" to={newHref}>
            {Icon.plus}<span>Add expense</span>
          </Link>
        </>
      )}
    </>
  );
}

function lastDayOf(ym: { year: number; month: number }) {
  const today = istToday();
  const last = new Date(Date.UTC(ym.year, ym.month, 0)).toISOString().slice(0, 10);
  return last < today ? last : today;
}

function SummaryCards({ summary }: { summary: MonthSummary }) {
  const people = summary.people;
  return (
    <section className="grid-cards" aria-label="Month summary">
      <div className="card stat wide">
        <div className="stat-label">Total spent</div>
        <div className="big num">{formatPaise(summary.total_paise)}</div>
        <div className="stat-sub">
          {summary.participant_count > 0
            ? `Split equally between ${summary.participant_count} ${summary.participant_count === 1 ? 'person' : 'people'}`
            : 'No one to split with yet'}
        </div>
      </div>
      {people.map((p) => (
        <div key={p.user_id} className="card stat">
          <div className="stat-label truncate">{p.display_name}{!p.is_participant && ' (not in split)'}</div>
          <div className="stat-value num">{formatPaise(p.paid_paise)}</div>
          <div className="stat-sub">paid · share {formatPaise(p.share_paise)}</div>
          <div className={`tiny num ${p.balance_paise > 0 ? 'positive' : p.balance_paise < 0 ? 'negative' : 'muted'}`} style={{ marginTop: 4, fontWeight: 600 }}>
            {p.balance_paise > 0 ? `Gets back ${formatPaise(p.balance_paise)}` : p.balance_paise < 0 ? `Owes ${formatPaise(-p.balance_paise)}` : 'All square'}
          </div>
        </div>
      ))}
    </section>
  );
}

function SettlementCard({ summary, ymKey }: { summary: MonthSummary; ymKey: string }) {
  const { nameOf } = useApp();
  const closed = summary.status === 'closed';
  const lines = closed ? summary.payments.filter((p) => p.amount_paise > 0) : summary.transfers;
  const settledCount = closed ? lines.filter((p) => isSettled(p as Payment)).length : 0;
  const href = summary.is_current ? '/settlement' : `/settlement?m=${ymKey}`;
  return (
    <section className="card" aria-labelledby="settle-h">
      <div className="card-head">
        <h2 id="settle-h">{closed ? 'Final settlement' : 'Interim settlement'}</h2>
        {closed
          ? <span className="badge closed">Month closed</span>
          : <span className="badge warn">{summary.is_current ? 'Interim — month in progress' : summary.status === 'reopened' ? 'Interim — reopened' : 'Interim — waiting for Owner to close'}</span>}
      </div>
      {lines.length === 0 ? (
        <p className="muted small">{summary.total_paise === 0 ? 'Nothing to settle yet.' : 'Everyone is square — no payments needed. 🎉'}</p>
      ) : (
        lines.map((t, i) => <TransferLine key={i} from={nameOf(t.from)} to={nameOf(t.to)} paise={t.amount_paise} />)
      )}
      <div className="row" style={{ marginTop: 8 }}>
        {closed && lines.length > 0 && <span className="small muted">{settledCount} of {lines.length} settled</span>}
        <span className="spacer" />
        <Link to={href} className="btn ghost sm">Details <span style={{ width: 16, height: 16, display: 'inline-flex' }}>{Icon.right}</span></Link>
      </div>
    </section>
  );
}

function BreakdownCard({ expenses }: { expenses: Expense[] }) {
  const { categories } = useApp();
  const slices = useMemo<Slice[]>(() => {
    const byCat = new Map<string, number>();
    for (const e of expenses) byCat.set(e.category_id, (byCat.get(e.category_id) ?? 0) + toPaise(e.amount));
    return categories
      .map((c, i) => ({ label: c.name, paise: byCat.get(c.id) ?? 0, colour: categoryColour(i) }))
      .filter((s) => s.paise > 0)
      .sort((a, b) => b.paise - a.paise);
  }, [expenses, categories]);
  return (
    <section className="card" aria-labelledby="cat-h">
      <div className="card-head"><h2 id="cat-h">By category</h2></div>
      <CategoryDonut slices={slices} />
    </section>
  );
}

function ExpenseList({ expenses, monthName, isCurrent, canAdd }: { expenses: Expense[]; monthName: string; isCurrent: boolean; canAdd: boolean }) {
  const { categories, members, nameOf } = useApp();
  const [person, setPerson] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');

  const catIndex = useMemo(() => new Map(categories.map((c, i) => [c.id, i])), [categories]);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Other';
  const payers = useMemo(() => payerFilterOptions(members, expenses), [expenses, members]);

  const filtered = expenses.filter((e) =>
    (!person || e.paid_by === person) &&
    (!category || e.category_id === category) &&
    (!q.trim() || e.description.toLowerCase().includes(q.trim().toLowerCase())));

  const groups = useMemo(() => {
    const m = new Map<string, Expense[]>();
    for (const e of filtered) m.set(e.expense_date, [...(m.get(e.expense_date) ?? []), e]);
    return [...m.entries()];
  }, [filtered]);

  if (expenses.length === 0) {
    return (
      <section className="card">
        <EmptyState title={isCurrent ? 'No expenses yet this month' : `No expenses in ${monthName}`}>
          {canAdd && <p className="small">{isCurrent ? 'Add your first one — it takes a few seconds.' : 'Nothing was logged for this month.'}</p>}
        </EmptyState>
      </section>
    );
  }

  const today = istToday();
  const filtering = person || category || q.trim();
  return (
    <section aria-labelledby="exp-h" className="stack">
      <div className="row"><h2 id="exp-h">Expenses</h2><span className="badge">{filtered.length}</span></div>
      <div className="filters">
        <label className="sr-only" htmlFor="f-q">Search descriptions</label>
        <input id="f-q" className="input search" type="search" placeholder="Search descriptions" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sr-only" htmlFor="f-person">Filter by who paid</label>
        <select id="f-person" className="input" value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Anyone paid</option>
          {payers.map((m) => <option key={m.user_id} value={m.user_id}>Paid by {m.profile?.display_name}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-cat">Filter by category</label>
        <select id="f-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <div className="card"><EmptyState icon="🔍" title="No matching expenses">
          {filtering && <button className="btn ghost sm" onClick={() => { setPerson(''); setCategory(''); setQ(''); }}>Clear filters</button>}
        </EmptyState></div>
      ) : groups.map(([date, rows]) => (
        <div key={date} className="day-group">
          <div className="day-head">
            <span>{dayLabel(date, today)}</span>
            <span className="num">{formatPaise(rows.reduce((a, e) => a + toPaise(e.amount), 0))}</span>
          </div>
          <ul className="expense-list">
            {rows.map((e) => {
              const cName = catName(e.category_id);
              const paidBy = nameOf(e.paid_by);
              const loggedBy = nameOf(e.logged_by);
              return (
                <li key={e.id}>
                  <Link to={`/expenses/${e.id}`} className="expense-row">
                    <span className="cat-dot" style={{ background: categoryColour(catIndex.get(e.category_id) ?? 0) }} aria-hidden="true">{initials(cName)}</span>
                    <div className="expense-main">
                      <div className="expense-title">{e.description}</div>
                      <div className="expense-meta">{cName}</div>
                      <div className="expense-meta wrap">
                        Paid by {paidBy}{loggedBy !== paidBy ? ` · Logged by ${loggedBy}` : ''}
                      </div>
                    </div>
                    <div className="expense-amount num">{formatPaise(toPaise(e.amount))}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

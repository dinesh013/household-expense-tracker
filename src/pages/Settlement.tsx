import { useState } from 'react';
import { useApp } from '../lib/session';
import { useMonthData, useSelectedMonth } from '../lib/useMonth';
import { errorText, rpc } from '../lib/api';
import { dateTimeLabel, formatPaise, istToday, monthLabel, monthRange, shortDate } from '../lib/format';
import type { MonthSummary, Payment } from '../lib/types';
import { isSettled } from '../lib/settlement';
import { MonthSwitcher, Spinner, StatusBadge, useToast } from '../components/ui';
import { TransferLine } from '../components/charts';

export default function Settlement() {
  const { household, isOwner, nameOf } = useApp();
  const ym = useSelectedMonth();
  const { summary, loading, error, reload } = useMonthData(household!.id, ym, false);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function ownerAction(fn: 'close_month' | 'reopen_month') {
    const label = monthLabel(ym);
    const msg = fn === 'reopen_month'
      ? `Reopen ${label}? Its expenses become editable again. Paid marks are kept and matched to the new figures when you close it again.`
      : `Close ${label}? This makes the settlement final and locks the month's expenses.`;
    if (!confirm(msg)) return;
    setBusy(true);
    setActionError(null);
    try {
      await rpc(fn, { p_household: household!.id, p_year: ym.year, p_month: ym.month });
      toast(fn === 'reopen_month' ? 'Month reopened' : 'Month closed');
      await reload();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <MonthSwitcher value={ym} basePath="/settlement" badge={summary && <StatusBadge status={summary.status} isCurrent={summary.is_current} />} />
      {(error || actionError) && <div className="alert error" role="alert">{error ?? actionError}</div>}
      {loading || !summary ? <Spinner /> : (
        <>
          <StatusNote summary={summary} nameOf={nameOf} />
          <Payments summary={summary} onChanged={reload} />
          {summary.status === 'reopened' && summary.payments.length > 0 && <RecordedPayments summary={summary} onChanged={reload} />}
          <Breakdown summary={summary} />
          {isOwner && (summary.is_past || summary.status === 'closed') && (
            <section className="card stack">
              <h2>Owner actions</h2>
              {summary.status === 'closed' ? (
                <>
                  <p className="small muted">Need to fix an expense? Reopen the month, make the correction, then close it again to recalculate. Paid marks are kept.</p>
                  <button className="btn secondary" disabled={busy} onClick={() => ownerAction('reopen_month')}>Reopen month</button>
                </>
              ) : (
                <>
                  <p className="small muted">
                    {summary.status === 'reopened'
                      ? 'Close the month again when your corrections are done.'
                      : 'This month has ended. Closing it makes the settlement final and locks its expenses.'}
                  </p>
                  <button className="btn" disabled={busy} onClick={() => ownerAction('close_month')}>Close month & finalise</button>
                </>
              )}
            </section>
          )}
          <p className="tiny muted">
            How it works: everything spent in the month is added up and split equally between the Owner and Members
            (Viewers aren't included). Each person's balance is what they paid minus their share, and the fewest payments
            needed to even things out are listed above. Amounts are exact to the paisa; any leftover paisa goes to one person
            so the totals always match.
          </p>
        </>
      )}
    </>
  );
}

function StatusNote({ summary, nameOf }: { summary: MonthSummary; nameOf: (id: string | null | undefined) => string }) {
  if (summary.status === 'closed') {
    return (
      <div className="alert info">
        Final settlement. Closed {summary.closed_at ? dateTimeLabel(summary.closed_at) : ''}
        {summary.closed_by ? ` by ${nameOf(summary.closed_by)}` : ''}. Expenses for this month are locked.
      </div>
    );
  }
  if (summary.is_current) {
    return <div className="alert warn"><strong>Interim — month in progress.</strong> Based on expenses so far. The Owner closes the month after it ends to make it final.</div>;
  }
  if (summary.status === 'reopened') {
    return <div className="alert warn"><strong>Interim — reopened.</strong> The Owner reopened this month{summary.reopened_at ? ` on ${dateTimeLabel(summary.reopened_at)}` : ''} for corrections.</div>;
  }
  return <div className="alert warn"><strong>Interim.</strong> This month has ended and is waiting for the Owner to close it.</div>;
}

function Payments({ summary, onChanged }: { summary: MonthSummary; onChanged: () => Promise<void> }) {
  const { nameOf } = useApp();
  const closed = summary.status === 'closed';
  const count = closed ? summary.payments.filter((p) => p.amount_paise > 0 || p.paid_on).length : summary.transfers.length;
  const settled = summary.payments.filter(isSettled).length;
  return (
    <section className="card" aria-labelledby="pay-h">
      <div className="card-head">
        <h2 id="pay-h">{closed ? 'Who pays whom' : 'Who pays whom (so far)'}</h2>
        {closed && count > 0 && (
          <span className={`badge ${settled === count ? 'accent' : 'warn'}`}>{settled === count ? 'All settled' : `${settled}/${count} settled`}</span>
        )}
      </div>
      {count === 0 ? (
        <p className="small muted">{summary.total_paise === 0 ? 'No expenses this month, so nothing to settle.' : 'Everyone paid exactly their share — nothing to settle. 🎉'}</p>
      ) : closed ? (
        summary.payments.map((p) => <PaymentRow key={p.id} p={p} summary={summary} onChanged={onChanged} />)
      ) : (
        summary.transfers.map((t, i) => <TransferLine key={i} from={nameOf(t.from)} to={nameOf(t.to)} paise={t.amount_paise} />)
      )}
    </section>
  );
}

function RecordedPayments({ summary, onChanged }: { summary: MonthSummary; onChanged: () => Promise<void> }) {
  return (
    <section className="card" aria-labelledby="rec-h">
      <div className="card-head"><h2 id="rec-h">Recorded at the last close</h2></div>
      <p className="small muted">These Paid marks are kept. When the month is closed again they're matched to the new figures.</p>
      {summary.payments.map((p) => <PaymentRow key={p.id} p={p} summary={summary} onChanged={onChanged} readOnly />)}
    </section>
  );
}

function PaymentRow({ p, summary, onChanged, readOnly = false }: { p: Payment; summary: MonthSummary; onChanged: () => Promise<void>; readOnly?: boolean }) {
  const { nameOf, profile, isOwner } = useApp();
  const toast = useToast();
  const today = istToday();
  const [marking, setMarking] = useState(false);
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canMark = !readOnly && (isOwner || profile?.id === p.from || profile?.id === p.to);
  const minDate = monthRange(summary).from;
  const from = nameOf(p.from);
  const to = nameOf(p.to);
  const paid = p.paid_on ? p.paid_amount_paise ?? 0 : 0;
  const diff = p.amount_paise - paid;

  async function save(paidOn: string | null) {
    if (paidOn && (paidOn < minDate || paidOn > today)) return setError('Pick a date between the start of that month and today.');
    setBusy(true);
    setError(null);
    try {
      await rpc('mark_payment', { p_payment: p.id, p_paid_on: paidOn });
      toast(paidOn ? 'Marked as paid' : 'Paid mark removed');
      setMarking(false);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const markControls = marking ? (
    <div className="row wrap small" style={{ marginTop: 6 }}>
      <label className="sr-only" htmlFor={`paid-${p.id}`}>Date paid</label>
      <input id={`paid-${p.id}`} type="date" className="input" style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} min={minDate} max={today} value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="btn sm" disabled={busy} onClick={() => save(date)}>Save</button>
      <button className="btn ghost sm" onClick={() => setMarking(false)}>Cancel</button>
    </div>
  ) : null;

  return (
    <TransferLine from={from} to={to} paise={p.amount_paise > 0 ? p.amount_paise : paid}>
      {!p.paid_on ? (
        <div className="row wrap small">
          <span className="badge warn">Not paid yet</span>
          {canMark && !marking && <button className="btn ghost sm" onClick={() => setMarking(true)}>Mark as paid</button>}
        </div>
      ) : diff === 0 ? (
        <div className="row wrap small">
          <span className="badge accent">Paid {shortDate(p.paid_on)}</span>
          {p.marked_by && <span className="tiny muted">marked by {nameOf(p.marked_by)}</span>}
          {canMark && <button className="btn ghost sm" disabled={busy} onClick={() => save(null)}>Undo</button>}
        </div>
      ) : (
        <div className="stack small" style={{ gap: 4 }}>
          <div className="row wrap">
            <span className="badge warn">Paid {formatPaise(paid)} on {shortDate(p.paid_on)}</span>
            {canMark && <button className="btn ghost sm" disabled={busy} onClick={() => save(null)}>Undo</button>}
          </div>
          <span className="tiny muted">
            {p.amount_paise === 0
              ? `No longer owed after the month was recalculated: ${to} should return ${formatPaise(paid)} to ${from}.`
              : diff > 0
                ? `Recalculated to ${formatPaise(p.amount_paise)}: ${formatPaise(diff)} still to pay.`
                : `Recalculated to ${formatPaise(p.amount_paise)}: ${to} should return ${formatPaise(-diff)} to ${from}.`}
          </span>
          {canMark && diff > 0 && !marking && <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setMarking(true)}>Mark full amount paid</button>}
        </div>
      )}
      {markControls}
      {error && <div className="field-error">{error}</div>}
    </TransferLine>
  );
}

function Breakdown({ summary }: { summary: MonthSummary }) {
  return (
    <section className="card" aria-labelledby="bd-h">
      <div className="card-head">
        <h2 id="bd-h">Breakdown</h2>
        <span className="small muted num">Total {formatPaise(summary.total_paise)}</span>
      </div>
      {summary.people.length === 0 ? (
        <p className="small muted">No one to show yet.</p>
      ) : (
        <table className="people-table">
          <thead>
            <tr><th scope="col">Person</th><th scope="col">Paid</th><th scope="col">Fair share</th><th scope="col">Balance</th></tr>
          </thead>
          <tbody>
            {summary.people.map((p) => (
              <tr key={p.user_id}>
                <td>{p.display_name}{!p.is_participant && <span className="tiny muted"> (not in split)</span>}</td>
                <td className="num">{formatPaise(p.paid_paise)}</td>
                <td className="num">{formatPaise(p.share_paise)}</td>
                <td className={`num ${p.balance_paise > 0 ? 'positive' : p.balance_paise < 0 ? 'negative' : ''}`}>
                  {p.balance_paise > 0 ? '+' : ''}{formatPaise(p.balance_paise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

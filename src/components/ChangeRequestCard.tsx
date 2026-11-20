import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText, rpc } from '../lib/api';
import { dateTimeLabel, formatRupees } from '../lib/format';
import { requestLines, STATUS_LABEL } from '../lib/changeRequests';
import type { Lookup } from '../lib/activity';
import type { ChangeRequest } from '../lib/types';
import { useToast } from './ui';

const BADGE: Record<ChangeRequest['status'], string> = { pending: 'warn', approved: 'accent', rejected: 'danger', cancelled: '' };

/**
 * One change request: what was asked and why, its status, and the actions the viewer may take
 * (Owner: approve / reject with a reason; requester: withdraw while pending).
 */
export function ChangeRequestCard({ cr, look, isOwner, myId, showExpenseLink, onDecided }: {
  cr: ChangeRequest; look: Lookup; isOwner: boolean; myId: string | undefined; showExpenseLink?: boolean;
  onDecided: (cr: ChangeRequest, outcome: 'approved' | 'rejected' | 'cancelled') => void | Promise<void>;
}) {
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = cr.status === 'pending';
  const s = cr.expense_snapshot;
  // An approved delete removed the expense, so there is nothing to open.
  const linkable = showExpenseLink && !(cr.status === 'approved' && cr.kind === 'delete');

  async function act(outcome: 'approved' | 'rejected' | 'cancelled') {
    if (outcome === 'rejected' && !note.trim()) return setError('Say why, so they know what to do next.');
    setBusy(true);
    setError(null);
    try {
      if (outcome === 'cancelled') await rpc('cancel_change_request', { p_request: cr.id });
      else await rpc('decide_change_request', { p_request: cr.id, p_approve: outcome === 'approved', p_note: outcome === 'rejected' ? note.trim() : null });
      toast(outcome === 'approved' ? 'Approved and applied' : outcome === 'rejected' ? 'Request rejected' : 'Request withdrawn');
      await onDecided(cr, outcome);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const title = <><strong>{s.description}</strong> · {formatRupees(s.amount)}</>;
  return (
    <div className="cr-card stack" role="group" aria-label={`Change request for ${s.description}`}>
      <div className="row wrap">
        <span className="grow">
          {linkable ? <Link to={`/expenses/${cr.expense_id}`}>{title}</Link> : title}
        </span>
        <span className={`badge ${BADGE[cr.status]}`}>{STATUS_LABEL[cr.status]}</span>
      </div>
      <ul className="change-list">
        {requestLines(cr, look).map((l) => <li key={l}>{l}</li>)}
      </ul>
      <div className="small"><span className="muted">Reason:</span> {cr.reason}</div>
      <div className="tiny muted">Asked by {look.nameOf(cr.requested_by)} · {dateTimeLabel(cr.requested_at)}</div>
      {cr.decided_at && cr.status !== 'pending' && (
        <div className="tiny muted">
          {STATUS_LABEL[cr.status]} by {look.nameOf(cr.decided_by)} · {dateTimeLabel(cr.decided_at)}
          {cr.decision_note && <> · “{cr.decision_note}”</>}
        </div>
      )}
      {error && <div className="alert error" role="alert">{error}</div>}

      {pending && isOwner && !rejecting && (
        <div className="row wrap">
          <button type="button" className="btn sm" disabled={busy} onClick={() => act('approved')}>
            {cr.kind === 'delete' ? 'Approve & delete' : 'Approve & apply'}
          </button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setRejecting(true); setError(null); }}>Reject</button>
        </div>
      )}
      {pending && isOwner && rejecting && (
        <div className="stack">
          <label className="small" htmlFor={`rej-${cr.id}`}>Why are you rejecting it?</label>
          <input id={`rej-${cr.id}`} className="input" maxLength={300} value={note} autoFocus onChange={(e) => setNote(e.target.value)} />
          <div className="row wrap">
            <button type="button" className="btn danger sm" disabled={busy} onClick={() => act('rejected')}>Reject request</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setRejecting(false); setNote(''); setError(null); }}>Back</button>
          </div>
        </div>
      )}
      {pending && !isOwner && cr.requested_by === myId && (
        <div><button type="button" className="btn ghost sm" disabled={busy} onClick={() => act('cancelled')}>Withdraw request</button></div>
      )}
    </div>
  );
}

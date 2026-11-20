import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { errorText, must } from '../../lib/api';
import { useApp } from '../../lib/session';
import { dayLabel, formatRupees, istToday, shortDate } from '../../lib/format';
import { ACTION_VERB, ACTIVITY_PAGE, appendPage, changeLines, groupByDay, timeLabel, type ActivityKind, type Lookup } from '../../lib/activity';
import type { ActivityEntry, ChangeRequest } from '../../lib/types';
import { Avatar, EmptyState, Spinner } from '../../components/ui';
import { ChangeRequestCard } from '../../components/ChangeRequestCard';
import { CR_COLUMNS } from '../../lib/changeRequests';

const COLUMNS = 'id, seq, expense_id, action, changed_by, changed_at, changes, snapshot';

/** Household audit log: who added, edited or deleted which expense, and when. Every member can read it. */
export default function Activity() {
  const { household, members, categories, nameOf, revalidate, isOwner, profile } = useApp();
  const [who, setWho] = useState('');
  const [kind, setKind] = useState<ActivityKind>('');
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Names of people who joined since the app loaded.
  useEffect(() => { revalidate(); }, [revalidate]);

  const fetchPage = useCallback(async (beforeSeq: number | null) => {
    let q = supabase.from('expense_history').select(COLUMNS).eq('household_id', household!.id);
    if (who) q = q.eq('changed_by', who);
    if (kind) q = q.eq('action', kind);
    if (beforeSeq !== null) q = q.lt('seq', beforeSeq);
    const rows = (await must(q.order('seq', { ascending: false }).limit(ACTIVITY_PAGE + 1))) as ActivityEntry[];
    return { page: rows.slice(0, ACTIVITY_PAGE), more: rows.length > ACTIVITY_PAGE };
  }, [household, who, kind, reloadKey]); // reloadKey: reload after a request is approved

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPage(null)
      .then(({ page, more }) => { if (!cancelled) { setEntries(page); setHasMore(more); } })
      .catch((e) => { if (!cancelled) setError(errorText(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchPage]);

  async function loadMore() {
    setLoadingMore(true);
    setError(null);
    try {
      const { page, more } = await fetchPage(entries[entries.length - 1].seq);
      setEntries((shown) => appendPage(shown, page));
      setHasMore(more);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  const look: Lookup = useMemo(() => ({ nameOf, categoryName: (id) => categories.find((c) => c.id === id)?.name }), [nameOf, categories]);
  const deleted = useMemo(() => new Set(entries.filter((e) => e.action === 'deleted').map((e) => e.expense_id)), [entries]);
  const people = members.filter((m) => m.profile);
  const today = istToday();
  const filtering = Boolean(who || kind);

  return (
    <>
      <ChangeRequests look={look} isOwner={isOwner} myId={profile?.id} householdId={household!.id}
        onDecided={() => setReloadKey((k) => k + 1)} />

      <p className="small muted">Every expense added, edited or deleted in {household?.name}, newest first. Everyone in the household can see this.</p>
      <div className="filters">
        <div>
          <label className="sr-only" htmlFor="act-who">Done by</label>
          <select id="act-who" className="input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {people.map((m) => <option key={m.user_id} value={m.user_id}>{m.profile!.display_name}{m.removed_at ? ' (removed)' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="sr-only" htmlFor="act-kind">Type of change</label>
          <select id="act-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as ActivityKind)}>
            <option value="">All changes</option>
            <option value="created">Added</option>
            <option value="updated">Edited</option>
            <option value="deleted">Deleted</option>
          </select>
        </div>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}

      {loading ? <Spinner /> : entries.length === 0 ? (
        <div className="card"><EmptyState icon="🕘" title={filtering ? 'Nothing matches these filters' : 'No activity yet'}>
          {filtering && <button className="btn ghost sm" onClick={() => { setWho(''); setKind(''); }}>Clear filters</button>}
        </EmptyState></div>
      ) : (
        <section aria-label="Activity">
          {groupByDay(entries).map(([day, rows]) => (
            <div key={day} className="day-group">
              <div className="day-head"><span>{dayLabel(day, today)}</span></div>
              <ul className="expense-list">
                {rows.map((e) => <ActivityItem key={e.id} e={e} look={look} gone={deleted.has(e.expense_id)} />)}
              </ul>
            </div>
          ))}
          {hasMore && (
            <button className="btn secondary block" style={{ marginTop: 14 }} disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Loading…' : 'Show older activity'}
            </button>
          )}
        </section>
      )}
    </>
  );
}

function ActivityItem({ e, look, gone }: { e: ActivityEntry; look: Lookup; gone: boolean }) {
  const who = look.nameOf(e.changed_by);
  const s = e.snapshot;
  const title = s?.description ?? 'an expense';
  const isDelete = e.action === 'deleted';
  const details = s && [`For ${shortDate(s.expense_date)}`, look.categoryName(s.category_id) ?? 'a removed category', `Paid by ${look.nameOf(s.paid_by)}`].join(' · ');

  const body = (
    <>
      <Avatar name={who} />
      <div className="expense-main">
        <div className="activity-line"><strong>{who}</strong> {ACTION_VERB[e.action]} <span className={isDelete ? 'struck' : ''}>{title}</span></div>
        {e.action === 'updated' ? (
          <ul className="change-list">
            {changeLines(e, look).map((l) => <li key={l}>{l}</li>)}
          </ul>
        ) : details && <div className="expense-meta wrap">{details}</div>}
        {e.action === 'updated' && s && <div className="expense-meta wrap">For {shortDate(s.expense_date)}</div>}
        {s?.note && e.action !== 'updated' && <div className="expense-meta wrap">Note: {s.note}</div>}
        <div className="expense-meta">{timeLabel(e.changed_at)}</div>
      </div>
      {s && e.action !== 'updated' && <div className={`expense-amount num${isDelete ? ' struck' : ''}`}>{formatRupees(s.amount)}</div>}
    </>
  );

  return (
    <li>
      {gone ? (
        <div className="expense-row activity-row">{body}</div>
      ) : (
        <Link to={`/expenses/${e.expense_id}`} className="expense-row activity-row">{body}</Link>
      )}
    </li>
  );
}

/** Pending change requests first (the Owner approves or rejects here), then the last few decisions. */
function ChangeRequests({ look, isOwner, myId, householdId, onDecided }: {
  look: Lookup; isOwner: boolean; myId: string | undefined; householdId: string; onDecided: () => void;
}) {
  const [requests, setRequests] = useState<ChangeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await must(supabase.from('change_requests').select(CR_COLUMNS).eq('household_id', householdId)
        .order('requested_at', { ascending: false }).limit(30));
      setRequests(rows as ChangeRequest[]);
    } catch (e) {
      setError(errorText(e));
    }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!requests || requests.length === 0) return null;
  const pending = requests.filter((r) => r.status === 'pending');
  const recent = requests.filter((r) => r.status !== 'pending').slice(0, 5);
  const refresh = async () => { await load(); onDecided(); };

  return (
    <section className="card stack" aria-labelledby="cr-h">
      <div className="card-head">
        <h2 id="cr-h">Change requests</h2>
        {pending.length > 0 && <span className="badge warn">{pending.length} waiting</span>}
      </div>
      {pending.length === 0 && <p className="small muted">Nothing waiting.</p>}
      {pending.map((r) => <ChangeRequestCard key={r.id} cr={r} look={look} isOwner={isOwner} myId={myId} showExpenseLink onDecided={refresh} />)}
      {recent.length > 0 && (
        <details>
          <summary className="small">Recent decisions ({recent.length})</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            {recent.map((r) => <ChangeRequestCard key={r.id} cr={r} look={look} isOwner={isOwner} myId={myId} showExpenseLink onDecided={refresh} />)}
          </div>
        </details>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { errorText, must, rpc } from '../../lib/api';
import { useApp } from '../../lib/session';
import { shortDate } from '../../lib/format';
import { inviteLink } from '../../lib/invite';
import { ROLE_LABEL, type Invite, type Member, type Role } from '../../lib/types';
import { Avatar, useToast } from '../../components/ui';

export default function Access() {
  const { household, members, isOwner, profile, refresh } = useApp();
  const toast = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [label, setLabel] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    if (!isOwner || !household) return;
    const rows = await must(supabase
      .from('household_invites')
      .select('id, token, label, role, created_at, expires_at')
      .eq('household_id', household.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }));
    setInvites(rows as Invite[]);
  }, [isOwner, household]);

  useEffect(() => { loadInvites().catch((e) => setError(errorText(e))); }, [loadInvites]);

  async function run(action: () => Promise<unknown>, done: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast(done);
      await Promise.all([refresh(), loadInvites()]);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createLink(e: FormEvent) {
    e.preventDefault();
    if (label.trim().length > 60) return setError('Keep the name under 60 characters.');
    let token = '';
    const ok = await run(async () => {
      token = await rpc<string>('create_invite', { p_household: household!.id, p_role: role, p_label: label.trim() || null });
    }, 'Invite link created');
    if (ok) {
      setNewToken(token);
      setLabel('');
    }
  }

  const active = members.filter((m) => !m.removed_at);

  return (
    <>
      {error && <div className="alert error" role="alert">{error}</div>}

      <section className="card" aria-labelledby="people-h">
        <div className="card-head">
          <h2 id="people-h">People in {household?.name}</h2>
          <span className="badge">{active.length}</span>
        </div>
        <ul className="list">
          {active.map((m) => (
            <MemberRow
              key={m.id}
              m={m}
              isSelf={m.user_id === profile?.id}
              canManage={isOwner && m.role !== 'owner'}
              busy={busy}
              onRole={(r) => run(() => rpc('change_member_role', { p_member: m.id, p_role: r }), 'Role updated')}
              onRemove={() => {
                if (confirm(`Remove ${m.profile?.display_name} from the household? They will lose access straight away. Their past expenses stay.`)) {
                  void run(() => rpc('remove_member', { p_member: m.id }), 'Removed');
                }
              }}
            />
          ))}
        </ul>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Owner and Members log expenses and share the monthly split. Viewers can see everything but can't add expenses and aren't part of the split.
        </p>
      </section>

      {isOwner ? (
        <>
          <form className="card stack" onSubmit={createLink} noValidate aria-labelledby="invite-h">
            <h2 id="invite-h">Invite someone</h2>
            <p className="small muted">Create a link and send it yourself (WhatsApp, SMS…). It works once and expires in 7 days.</p>
            <div className="form-grid two">
              <div className="field">
                <label htmlFor="inv-label">Who is it for? <span className="muted">(optional)</span></label>
                <input id="inv-label" className="input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Priya" />
              </div>
              <div className="field">
                <label htmlFor="inv-role">Role</label>
                <select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'viewer')}>
                  <option value="member">Member — can log expenses</option>
                  <option value="viewer">Viewer — view only</option>
                </select>
              </div>
            </div>
            <button className="btn" disabled={busy}>Create invite link</button>
            {newToken && (
              <div className="alert info stack">
                <span>Send this link to them. They create an account (or sign in) and tap Join.</span>
                <ShareLink token={newToken} />
              </div>
            )}
          </form>

          <section className="card" aria-labelledby="pending-h">
            <div className="card-head"><h2 id="pending-h">Pending invite links</h2></div>
            {invites.length === 0 ? (
              <p className="small muted">No pending invites.</p>
            ) : (
              <ul className="list">
                {invites.map((i) => {
                  const expired = Date.parse(i.expires_at) < Date.now();
                  return (
                  <li key={i.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                    <div className="grow">
                      <div className="truncate">{i.label ?? 'Invite link'}</div>
                      <div className="tiny muted">
                        {ROLE_LABEL[i.role]} · created {shortDate(i.created_at.slice(0, 10))} · {expired ? 'expired' : `expires ${shortDate(i.expires_at.slice(0, 10))}`}
                      </div>
                    </div>
                    {!expired && <ShareLink token={i.token} compact />}
                    <button className="btn danger-ghost sm" disabled={busy} onClick={() => run(() => rpc('cancel_invite', { p_invite: i.id }), expired ? 'Removed' : 'Invite cancelled')}>
                      {expired ? 'Remove' : 'Cancel'}
                    </button>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="small muted">Only the Owner can invite people or change roles.</p>
      )}
    </>
  );
}

function MemberRow({ m, isSelf, canManage, busy, onRole, onRemove }: {
  m: Member; isSelf: boolean; canManage: boolean; busy: boolean;
  onRole: (r: Exclude<Role, 'owner'>) => void; onRemove: () => void;
}) {
  const name = m.profile?.display_name ?? 'Unknown';
  return (
    <li className="list-item">
      <Avatar name={name} />
      <div className="grow">
        <div className="truncate"><strong>{name}</strong>{isSelf && <span className="muted"> (you)</span>}</div>
        <div className="tiny muted truncate">{m.profile?.email}</div>
      </div>
      {canManage ? (
        <>
          <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {name}</label>
          <select id={`role-${m.id}`} className="input" style={{ width: 'auto', minHeight: 36, padding: '6px 10px' }} value={m.role} disabled={busy}
            onChange={(e) => onRole(e.target.value as 'member' | 'viewer')}>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
          <button className="btn danger-ghost sm" disabled={busy} onClick={onRemove} aria-label={`Remove ${name}`}>Remove</button>
        </>
      ) : (
        <span className={`badge${m.role === 'owner' ? ' accent' : ''}`}>{ROLE_LABEL[m.role]}</span>
      )}
    </li>
  );
}

function ShareLink({ token, compact = false }: { token: string; compact?: boolean }) {
  const toast = useToast();
  const url = inviteLink(token);
  const canShare = typeof navigator.share === 'function';
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch {
      prompt('Copy this invite link:', url);
    }
  }
  return (
    <div className="row wrap">
      {!compact && <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Invite link" style={{ flex: 1, minWidth: 0 }} />}
      <button type="button" className="btn secondary sm" onClick={copy}>Copy link</button>
      {canShare && (
        <button type="button" className="btn secondary sm" onClick={() => navigator.share({ title: 'Join our household', url }).catch(() => {})}>Share</button>
      )}
    </div>
  );
}

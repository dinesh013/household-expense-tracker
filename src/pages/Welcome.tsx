import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { errorText, rpc } from '../lib/api';
import { useApp } from '../lib/session';
import { clearPendingInvite, pendingInvite, savePendingInvite, tokenFrom } from '../lib/invite';
import { ROLE_LABEL, type InviteInfo } from '../lib/types';

const STATE_TEXT: Record<Exclude<InviteInfo['state'], 'valid'>, string> = {
  expired: 'This invite link has expired. Ask the Owner for a new one.',
  accepted: 'This invite link has already been used. Ask the Owner for a new one.',
  cancelled: 'This invite link was cancelled. Ask the Owner for a new one.',
};

export default function Welcome() {
  const { profile, refresh } = useApp();
  const [token, setToken] = useState<string | null>(pendingInvite);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setInvite(null); return; }
    rpc<InviteInfo[]>('get_invite', { p_token: token })
      .then((rows) => {
        if (rows[0]) setInvite(rows[0]);
        else { setError('That invite link is not valid. Ask the Owner for a new one.'); forget(); }
      })
      .catch((e) => setError(errorText(e)));
  }, [token]);

  function forget() {
    clearPendingInvite();
    setToken(null);
  }

  function openLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const t = tokenFrom(link);
    if (!t) return setError('Paste the full invite link the Owner sent you.');
    savePendingInvite(t);
    setToken(t);
    setLink('');
  }

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await rpc('accept_invite', { p_token: token });
      clearPendingInvite();
      await refresh();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Give your household a name.');
    if (n.length > 80) return setError('Keep the name under 80 characters.');
    setBusy(true);
    setError(null);
    try {
      await rpc('create_household', { p_name: n });
      clearPendingInvite();
      await refresh();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo" aria-hidden="true">₹</div>
        <div style={{ textAlign: 'center' }} className="stack">
          <h1>Hi {profile?.display_name ?? 'there'} 👋</h1>
          <p className="muted small">Join the household you were invited to, or start a new one.</p>
        </div>
        {error && <div className="alert error" role="alert">{error}</div>}

        {invite ? (
          <section className="card stack" aria-labelledby="inv-h">
            <h2 id="inv-h">You're invited</h2>
            <p><strong>{invite.invited_by_name}</strong> invited you to <strong>{invite.household_name}</strong> as a {ROLE_LABEL[invite.role]}.</p>
            {invite.state === 'valid' ? (
              <div className="row">
                <button className="btn" disabled={busy} onClick={join}>Join {invite.household_name}</button>
                <button className="btn ghost sm" disabled={busy} onClick={forget}>Not now</button>
              </div>
            ) : (
              <>
                <div className="alert warn">{STATE_TEXT[invite.state]}</div>
                <button className="btn ghost sm" onClick={forget}>Dismiss</button>
              </>
            )}
          </section>
        ) : (
          <form className="card stack" onSubmit={openLink} noValidate>
            <h2>Have an invite link?</h2>
            <div className="row">
              <label className="sr-only" htmlFor="link">Invite link</label>
              <input id="link" className="input" placeholder="Paste the link here" value={link} onChange={(e) => setLink(e.target.value)} />
              <button className="btn">Open</button>
            </div>
          </form>
        )}

        <form className="card stack" onSubmit={create} noValidate>
          <h2>Start a new household</h2>
          <p className="small muted">You'll be the Owner: only you can invite people, change roles, and close or reopen months.</p>
          <div className="field">
            <label htmlFor="hname">Household name</label>
            <input id="hname" className="input" placeholder="e.g. Flat 4B" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <button className="btn block" disabled={busy}>Create household</button>
        </form>

        <p className="small muted" style={{ textAlign: 'center' }}>
          Signed in as {profile?.email}.{' '}
          <button className="btn ghost sm" onClick={() => void supabase.auth.signOut()}>Sign out</button>
        </p>
      </div>
    </div>
  );
}

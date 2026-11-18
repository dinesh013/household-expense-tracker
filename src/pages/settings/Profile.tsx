import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { errorText, must, rpc } from '../../lib/api';
import { useApp } from '../../lib/session';
import { ROLE_LABEL } from '../../lib/types';
import { useToast } from '../../components/ui';

export default function ProfileSettings() {
  const { profile, household, role, isOwner, refresh } = useApp();
  const toast = useToast();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [hname, setHname] = useState(household?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(done);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function saveName(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n || n.length > 60) return setError('Name must be 1–60 characters.');
    void act(() => must(supabase.from('profiles').update({ display_name: n }).eq('id', profile!.id)), 'Name saved');
  }

  function saveHousehold(e: FormEvent) {
    e.preventDefault();
    const n = hname.trim();
    if (!n || n.length > 80) return setError('Household name must be 1–80 characters.');
    void act(() => must(supabase.from('households').update({ name: n }).eq('id', household!.id)), 'Household renamed');
  }

  function leave() {
    if (!confirm(`Leave ${household?.name}? You'll lose access to its expenses. Your past expenses stay in the household.`)) return;
    void act(() => rpc('leave_household'), 'You left the household');
  }

  return (
    <>
      {error && <div className="alert error" role="alert">{error}</div>}
      <form className="card stack" onSubmit={saveName} noValidate>
        <h2>Your profile</h2>
        <div className="field">
          <label htmlFor="pname">Display name</label>
          <input id="pname" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
        <p className="small muted">{profile?.email} · {role ? ROLE_LABEL[role] : ''} in {household?.name}</p>
        <button className="btn" disabled={busy}>Save name</button>
      </form>

      {isOwner && (
        <form className="card stack" onSubmit={saveHousehold} noValidate>
          <h2>Household</h2>
          <div className="field">
            <label htmlFor="hname">Household name</label>
            <input id="hname" className="input" value={hname} maxLength={80} onChange={(e) => setHname(e.target.value)} />
          </div>
          <button className="btn" disabled={busy}>Save household name</button>
        </form>
      )}

      <section className="card stack">
        <h2>Account</h2>
        <div className="row wrap">
          <button className="btn secondary" onClick={() => void supabase.auth.signOut()}>Sign out</button>
          {!isOwner && <button className="btn danger-ghost" disabled={busy} onClick={leave}>Leave household</button>}
        </div>
        <p className="tiny muted">Theme follows your device by default — use the sun/moon button at the top to switch.</p>
      </section>
    </>
  );
}

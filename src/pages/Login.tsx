import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { friendlyError } from '../lib/api';
import { pendingInvite } from '../lib/invite';

type Mode = 'signin' | 'signup';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function Login() {
  const hasInvite = Boolean(pendingInvite());
  const [mode, setMode] = useState<Mode>(hasInvite ? 'signup' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) return setError('Enter a valid email address.');
    if (mode === 'signup' && !name.trim()) return setError('Tell us your name. It is shown on expenses you log.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { display_name: name.trim().slice(0, 60) } },
        });
        if (error) throw error;
        // Only happens if "Confirm email" is still switched on in Supabase (see README).
        if (!data.session) setInfo('Account created, but Supabase is set to require email confirmation. Ask the Owner to switch that off, then sign in.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit} noValidate>
        <div className="auth-logo" aria-hidden="true">₹</div>
        <div style={{ textAlign: 'center' }} className="stack">
          <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted small">Shared household expenses, split fairly every month.</p>
        </div>

        {hasInvite && <div className="alert info">You've been invited to a household. Create an account (or sign in) to join it.</div>}
        {error && <div className="alert error" role="alert">{error}</div>}
        {info && <div className="alert info" role="status">{info}</div>}

        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </div>

        <button className="btn block" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <p className="small muted" style={{ textAlign: 'center' }}>
          {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
          <button type="button" className="btn ghost sm" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); setInfo(null); }}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </form>
    </div>
  );
}

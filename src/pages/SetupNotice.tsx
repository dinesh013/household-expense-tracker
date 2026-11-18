export default function SetupNotice() {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-logo" aria-hidden="true">₹</div>
        <h1 style={{ textAlign: 'center' }}>Almost there</h1>
        <p className="muted">
          This app needs a Supabase project. Copy <code>.env.example</code> to <code>.env</code>, fill in
          <code> VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, run the SQL migrations, then restart
          the dev server. See the README for step-by-step setup.
        </p>
      </div>
    </div>
  );
}

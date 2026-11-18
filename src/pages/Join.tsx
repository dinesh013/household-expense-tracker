import { Link, Navigate, useParams } from 'react-router-dom';
import { useApp } from '../lib/session';
import { savePendingInvite, tokenFrom } from '../lib/invite';

/** /join/<token>: remember the token, then send the person to sign in or to the join screen. */
export default function Join() {
  const { token = '' } = useParams();
  const { session, household } = useApp();
  const valid = tokenFrom(token);

  if (valid && !household) {
    savePendingInvite(valid);
    return <Navigate to={session ? '/welcome' : '/login'} replace />;
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="auth-logo" aria-hidden="true">₹</div>
        {valid ? (
          <p>You're already part of <strong>{household?.name}</strong>, so this invite link can't be used with this account.</p>
        ) : (
          <p>This invite link looks incomplete. Ask the Owner to send it again.</p>
        )}
        <Link className="btn" to="/">Go to the app</Link>
      </div>
    </div>
  );
}

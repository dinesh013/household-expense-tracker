const KEY = 'het-invite-token';
const TOKEN_RE = /^[0-9a-f]{64}$/;

export const inviteLink = (token: string) => `${window.location.origin}/join/${token}`;

/** Accepts a bare token or a full /join/<token> link. */
export function tokenFrom(input: string): string | null {
  const t = input.trim().split('/join/').pop()?.split(/[?#\s]/)[0] ?? '';
  return TOKEN_RE.test(t) ? t : null;
}

export const savePendingInvite = (token: string) => localStorage.setItem(KEY, token);
export const pendingInvite = () => tokenFrom(localStorage.getItem(KEY) ?? '');
export const clearPendingInvite = () => localStorage.removeItem(KEY);

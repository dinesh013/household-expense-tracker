import type { Expense, Member } from './types';

/** Owner/Member rows that are currently active — the people who can be "Paid by". */
export const activePayers = (members: Member[]): Member[] =>
  members.filter((m) => !m.removed_at && (m.role === 'owner' || m.role === 'member'));

/**
 * Options for the dashboard's "Paid by" filter: everyone who can pay today, plus anyone else who paid
 * for something in the month shown (e.g. a removed member). One entry per person, in joining order.
 */
export function payerFilterOptions(members: Member[], expenses: Pick<Expense, 'paid_by'>[]): Member[] {
  const paid = new Set(expenses.map((e) => e.paid_by));
  const active = new Set(activePayers(members).map((m) => m.user_id));
  const seen = new Set<string>();
  return members.filter((m) => {
    if (seen.has(m.user_id) || !(active.has(m.user_id) || paid.has(m.user_id))) return false;
    seen.add(m.user_id);
    return true;
  });
}

/**
 * True when an expense names someone missing from the loaded member list, which means the list is out
 * of date (someone joined after the app loaded it) and should be fetched again.
 */
export const hasUnknownPeople = (members: Member[], expenses: Pick<Expense, 'paid_by' | 'logged_by'>[]): boolean => {
  const known = new Set(members.map((m) => m.user_id));
  return expenses.some((e) => !known.has(e.paid_by) || !known.has(e.logged_by));
};

/** How long a loaded member list is trusted before a page visit or app focus reloads it. */
export const MEMBERS_MAX_AGE_MS = 10_000;

export const isStale = (loadedAt: number, now: number, maxAgeMs = MEMBERS_MAX_AGE_MS): boolean =>
  now - loadedAt >= maxAgeMs;

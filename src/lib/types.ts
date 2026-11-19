export type Role = 'owner' | 'member' | 'viewer';

export interface Profile {
  id: string;
  email: string;
  display_name: string;
}

export interface Household {
  id: string;
  name: string;
  created_at: string;
}

export interface Member {
  id: string;
  user_id: string;
  role: Role;
  joined_at: string;
  removed_at: string | null;
  profile: { display_name: string; email: string } | null;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
}

export interface Expense {
  id: string;
  household_id: string;
  amount: string | number;
  description: string;
  category_id: string;
  expense_date: string;
  paid_by: string;
  logged_by: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface HistoryEntry {
  id: string;
  action: 'created' | 'updated' | 'deleted';
  changed_by: string | null;
  changed_at: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

/** The expense as it was right after a log entry (for a delete: as it was when deleted). */
export interface ExpenseSnapshot {
  amount: number | string;
  description: string;
  category_id: string;
  expense_date: string;
  paid_by: string;
  note: string | null;
}

/** One row of the household activity log (an expense added, edited or deleted). */
export interface ActivityEntry extends HistoryEntry {
  seq: number;
  expense_id: string;
  snapshot: ExpenseSnapshot | null;
}

export interface Person {
  user_id: string;
  display_name: string;
  paid_paise: number;
  share_paise: number;
  balance_paise: number;
  is_participant: boolean;
}

export interface Transfer {
  from: string;
  to: string;
  amount_paise: number;
}

export interface Payment extends Transfer {
  id: string;
  paid_amount_paise: number | null;
  paid_on: string | null;
  marked_by: string | null;
  marked_at: string | null;
}

export interface MonthSummary {
  year: number;
  month: number;
  status: 'open' | 'closed' | 'reopened';
  is_past: boolean;
  is_current: boolean;
  total_paise: number;
  participant_count: number;
  people: Person[];
  transfers: Transfer[];
  payments: Payment[];
  computed_at: string;
  closed_at?: string;
  closed_by?: string | null;
  reopened_at?: string | null;
}

export interface Invite {
  id: string;
  token: string;
  label: string | null;
  role: Exclude<Role, 'owner'>;
  created_at: string;
  expires_at: string;
}

export interface InviteInfo {
  household_name: string;
  role: Exclude<Role, 'owner'>;
  invited_by_name: string;
  state: 'valid' | 'expired' | 'accepted' | 'cancelled';
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', member: 'Member', viewer: 'Viewer' };

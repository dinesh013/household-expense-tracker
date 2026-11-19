import { formatRupees, shortDate, TZ } from './format';
import type { ActivityEntry } from './types';

/** Entries fetched per page of the activity log. */
export const ACTIVITY_PAGE = 30;

export type ActivityKind = '' | 'created' | 'updated' | 'deleted';

export const ACTION_VERB: Record<ActivityEntry['action'], string> = { created: 'added', updated: 'edited', deleted: 'deleted' };

export const FIELD_LABEL: Record<string, string> = {
  amount: 'amount', description: 'description', category_id: 'category', expense_date: 'date', paid_by: 'paid by', note: 'note',
};

/** Field order used when listing what an edit changed. */
const FIELD_ORDER = Object.keys(FIELD_LABEL);

export interface Lookup {
  nameOf: (userId: string | null | undefined) => string;
  categoryName: (id: string) => string | undefined;
}

/** A logged value in words: ₹ for amounts, names for people and categories, "—" for empty. */
export function formatValue(field: string, v: unknown, look: Lookup): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'amount') return formatRupees(v as number | string);
  if (field === 'category_id') return look.categoryName(String(v)) ?? 'a removed category';
  if (field === 'paid_by') return look.nameOf(String(v));
  if (field === 'expense_date') return shortDate(String(v));
  return `“${String(v)}”`;
}

/** What an edit changed, one line per field, e.g. "amount ₹120.00 → ₹150.00". */
export function changeLines(entry: Pick<ActivityEntry, 'changes'>, look: Lookup): string[] {
  return Object.entries(entry.changes ?? {})
    .sort(([a], [b]) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b))
    .map(([field, c]) => `${FIELD_LABEL[field] ?? field} ${formatValue(field, c.from, look)} → ${formatValue(field, c.to, look)}`);
}

/** The IST calendar day (YYYY-MM-DD) a timestamp falls on. */
export const istDayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));

/** "3:42 pm" in IST. */
export const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** Groups entries (already newest first) by the IST day they happened on, keeping order. */
export function groupByDay<T extends Pick<ActivityEntry, 'changed_at'>>(entries: T[]): [string, T[]][] {
  const groups: [string, T[]][] = [];
  for (const e of entries) {
    const day = istDayOf(e.changed_at);
    const last = groups[groups.length - 1];
    if (last && last[0] === day) last[1].push(e);
    else groups.push([day, [e]]);
  }
  return groups;
}

/** Appends a newly loaded page, dropping anything already shown. */
export function appendPage<T extends { id: string }>(shown: T[], page: T[]): T[] {
  const seen = new Set(shown.map((e) => e.id));
  return [...shown, ...page.filter((e) => !seen.has(e.id))];
}

import { formatValue, FIELD_LABEL, type Lookup } from './activity';
import type { ChangeRequest, Expense, ExpenseSnapshot } from './types';
import type { ValidExpense } from './format';

export const CR_COLUMNS = 'id, household_id, expense_id, kind, changes, expense_snapshot, reason, status, requested_by, requested_at, decided_by, decided_at, decision_note';

const FIELDS = ['amount', 'description', 'category_id', 'expense_date', 'paid_by', 'note'] as const;

/** The fields a requested edit actually changes, ready for request_expense_change. Empty if nothing changes. */
export function diffChanges(original: Pick<Expense, (typeof FIELDS)[number]>, next: ValidExpense): Partial<ValidExpense> {
  const out: Partial<Record<(typeof FIELDS)[number], string | null>> = {};
  for (const f of FIELDS) {
    const same = f === 'amount' ? Number(original.amount) === Number(next.amount) : (original[f] ?? null) === (next[f] ?? null);
    if (!same) out[f] = next[f];
  }
  return out as Partial<ValidExpense>;
}

/** "amount ₹640.00 → ₹620.00" for each requested change; "Delete this expense" for a delete. */
export function requestLines(cr: Pick<ChangeRequest, 'kind' | 'changes' | 'expense_snapshot'>, look: Lookup): string[] {
  if (cr.kind === 'delete') return ['Delete this expense'];
  return FIELDS.filter((f) => f in cr.changes).map((f) =>
    `${FIELD_LABEL[f]} ${formatValue(f, cr.expense_snapshot[f as keyof ExpenseSnapshot], look)} → ${formatValue(f, cr.changes[f as keyof ExpenseSnapshot], look)}`);
}

export const STATUS_LABEL: Record<ChangeRequest['status'], string> = {
  pending: 'Waiting for the Owner', approved: 'Approved', rejected: 'Rejected', cancelled: 'Withdrawn',
};

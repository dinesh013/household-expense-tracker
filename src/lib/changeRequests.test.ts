import { describe, expect, it } from 'vitest';
import { diffChanges, requestLines } from './changeRequests';

const original = { amount: '640.00', description: 'Dinner', category_id: 'c1', expense_date: '2026-11-10', paid_by: 'u1', note: null };
const look = { nameOf: (id: string | null | undefined) => (id === 'u2' ? 'Priya' : 'Arun'), categoryName: (id: string) => (id === 'c2' ? 'Groceries' : 'Dining') };

describe('change requests', () => {
  it('sends only the fields that change (amounts compared as numbers)', () => {
    expect(diffChanges(original, { ...original, amount: '640.0' })).toEqual({});
    expect(diffChanges(original, { ...original, amount: '620.00', paid_by: 'u2', note: 'cash' })).toEqual({ amount: '620.00', paid_by: 'u2', note: 'cash' });
  });

  it('describes a request as from → to lines', () => {
    const snap = { ...original, amount: 640 };
    expect(requestLines({ kind: 'edit', changes: { amount: 620, category_id: 'c2' }, expense_snapshot: snap }, look))
      .toEqual(['amount ₹640.00 → ₹620.00', 'category Dining → Groceries']);
    expect(requestLines({ kind: 'delete', changes: {}, expense_snapshot: snap }, look)).toEqual(['Delete this expense']);
  });
});

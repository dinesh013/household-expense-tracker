import { describe, expect, it } from 'vitest';
import { blankRow, isBlank, rowAfter, rowsTotalPaise, validateRows } from './expenseRows';
import { moveItem } from './order';

const today = '2026-11-19';
const base = { categoryId: 'cat-groceries', date: today, paidBy: 'me' };
const row = (amount: string, description: string, extra = {}) => ({ ...blankRow(base), amount, description, ...extra });

describe('several expenses in one save', () => {
  it('a new row copies category, date and payer, but not amount, description or note', () => {
    const first = row('250', 'Milk', { note: 'x', date: '2026-11-18', paidBy: 'roommate' });
    const next = rowAfter(first);
    expect(next).toMatchObject({ categoryId: 'cat-groceries', date: '2026-11-18', paidBy: 'roommate', amount: '', description: '', note: '' });
    expect(next.key).not.toBe(first.key);
  });

  it('saves the filled rows and skips extra blank ones', () => {
    const r = validateRows([row('250', 'Milk'), row('', ''), row('1,200.5', 'Rice')], today);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values.map((v) => [v.amount, v.description])).toEqual([['250.00', 'Milk'], ['1200.50', 'Rice']]);
  });

  it('refuses an all-blank form', () => {
    const r = validateRows([row('', ''), row('', '')], today);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Fill in at least one expense.');
  });

  it('names the rows that need fixing and nothing is saved', () => {
    const r = validateRows([row('250', 'Milk'), row('abc', 'Rice'), row('10', '', { date: '2026-11-20' })], today);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('Please fix the highlighted fields in expense 2, 3.');
      expect(r.errors[0]).toEqual({});
      expect(Object.keys(r.errors[1])).toEqual(['amount']);
      expect(Object.keys(r.errors[2]).sort()).toEqual(['date', 'description']);
    }
  });

  it('a row with only a note is not blank', () => {
    expect(isBlank(row('', ''))).toBe(true);
    expect(isBlank(row('', '', { note: 'paid cash' }))).toBe(false);
  });

  it('totals the valid amounts in paise', () => {
    expect(rowsTotalPaise([row('250', 'a'), row('0.05', 'b'), row('oops', 'c'), row('', '')])).toBe(25005);
  });
});

describe('category order', () => {
  it('moves an item one place and leaves the ends alone', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    const list = ['a', 'b'];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 1)).toBe(list);
  });
});

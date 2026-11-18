import { describe, expect, it } from 'vitest';
import { addMonths, currentMonth, formatPaise, formatRupees, istToday, monthRange, parseAmount, parseMonthKey, toPaise, validateExpense } from './format';

describe('Indian rupee formatting', () => {
  it('groups lakhs and crores Indian-style with 2 decimals', () => {
    expect(formatPaise(12_500_000)).toBe('₹1,25,000.00');
    expect(formatPaise(1_000_000_000)).toBe('₹1,00,00,000.00');
    expect(formatPaise(245_000)).toBe('₹2,450.00');
    expect(formatPaise(1)).toBe('₹0.01');
    expect(formatPaise(-33_334)).toBe('-₹333.34');
  });
  it('formats Postgres numeric strings without float drift', () => {
    expect(formatRupees('333.33')).toBe('₹333.33');
    expect(formatRupees('0.10')).toBe('₹0.10');
    expect(toPaise('0.10') + toPaise('0.20')).toBe(30);
    expect(toPaise('333.33')).toBe(33333);
  });
});

describe('parseAmount', () => {
  it('accepts common inputs', () => {
    expect(parseAmount('1250')).toEqual({ ok: true, value: '1250.00' });
    expect(parseAmount('₹1,25,000.5')).toEqual({ ok: true, value: '125000.50' });
    expect(parseAmount(' 0.01 ')).toEqual({ ok: true, value: '0.01' });
  });
  it('rejects zero, negatives, junk, too many decimals and huge values', () => {
    for (const bad of ['', '0', '0.00', '-5', 'abc', '1.234', '1e3', '10000000.01']) {
      expect(parseAmount(bad).ok, bad).toBe(false);
    }
  });
});

describe('validateExpense', () => {
  const base = { amount: '100', description: 'Milk', categoryId: 'c1', date: '2026-11-10', paidBy: 'u1', note: '' };
  it('normalises a valid expense', () => {
    const r = validateExpense({ ...base, description: '  Milk  ', note: '  ' }, '2026-11-18');
    expect(r).toEqual({ ok: true, value: { amount: '100.00', description: 'Milk', category_id: 'c1', expense_date: '2026-11-10', paid_by: 'u1', note: null } });
  });
  it('flags each invalid field', () => {
    const r = validateExpense({ amount: '-1', description: ' ', categoryId: '', date: '2026-11-19', paidBy: '', note: 'x'.repeat(501) }, '2026-11-18');
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors ?? {}).sort()).toEqual(['amount', 'categoryId', 'date', 'description', 'note', 'paidBy']);
  });
});

describe('months (Asia/Kolkata)', () => {
  it('uses IST, not UTC, for "today"', () => {
    // 2026-11-30 19:00 UTC is already 1 Dec 00:30 in India.
    const t = new Date('2026-11-30T19:00:00Z');
    expect(istToday(t)).toBe('2026-12-01');
    expect(currentMonth(t)).toEqual({ year: 2026, month: 12 });
  });
  it('steps across year boundaries', () => {
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(monthRange({ year: 2026, month: 12 })).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });
  it('parses only valid month keys', () => {
    expect(parseMonthKey('2026-02')).toEqual({ year: 2026, month: 2 });
    expect(parseMonthKey('2026-13')).toBeNull();
    expect(parseMonthKey('nope')).toBeNull();
  });
});

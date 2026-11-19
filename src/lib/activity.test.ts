import { describe, expect, it } from 'vitest';
import { appendPage, changeLines, formatValue, groupByDay, istDayOf } from './activity';

const look = {
  nameOf: (id: string | null | undefined) => ({ u1: 'Arun', u2: 'Priya' } as Record<string, string>)[id ?? ''] ?? 'Unknown',
  categoryName: (id: string) => ({ c1: 'Groceries', c2: 'Rent' } as Record<string, string>)[id],
};

describe('activity log', () => {
  it('formats logged values in words', () => {
    expect(formatValue('amount', 150, look)).toBe('₹150.00');
    expect(formatValue('paid_by', 'u2', look)).toBe('Priya');
    expect(formatValue('category_id', 'gone', look)).toBe('a removed category');
    expect(formatValue('note', null, look)).toBe('—');
    expect(formatValue('description', 'Milk', look)).toBe('“Milk”');
  });

  it('lists what an edit changed in a fixed field order', () => {
    const lines = changeLines({ changes: { paid_by: { from: 'u1', to: 'u2' }, amount: { from: 120, to: 150 } } }, look);
    expect(lines).toEqual(['amount ₹120.00 → ₹150.00', 'paid by Arun → Priya']);
  });

  it('groups by the IST day, so 11:30 pm UTC counts as the next morning in India', () => {
    expect(istDayOf('2026-11-18T19:00:00Z')).toBe('2026-11-19');
    const g = groupByDay([
      { changed_at: '2026-11-19T10:00:00Z' },
      { changed_at: '2026-11-18T19:00:00Z' },
      { changed_at: '2026-11-18T10:00:00Z' },
    ]);
    expect(g.map(([d, rows]) => [d, rows.length])).toEqual([['2026-11-19', 2], ['2026-11-18', 1]]);
  });

  it('a new page never repeats entries already shown', () => {
    expect(appendPage([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }]).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from './supabase';
import { errorText, must, rpc } from './api';
import { compareMonths, currentMonth, monthRange, parseMonthKey, type YearMonth } from './format';
import type { Expense, MonthSummary } from './types';

/** Month from ?m=YYYY-MM, never in the future; defaults to the current IST month. */
export function useSelectedMonth(): YearMonth {
  const [params] = useSearchParams();
  const now = currentMonth();
  const parsed = parseMonthKey(params.get('m'));
  return parsed && compareMonths(parsed, now) <= 0 ? parsed : now;
}

export function useMonthData(householdId: string, ym: YearMonth, withExpenses = true) {
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { year, month } = ym;

  const reload = useCallback(async () => {
    setError(null);
    try {
      const { from, to } = monthRange({ year, month });
      const [s, e] = await Promise.all([
        rpc<MonthSummary>('get_month_summary', { p_household: householdId, p_year: year, p_month: month }),
        withExpenses
          ? must(supabase
              .from('expenses')
              .select('*')
              .eq('household_id', householdId)
              .gte('expense_date', from)
              .lt('expense_date', to)
              .order('expense_date', { ascending: false })
              .order('created_at', { ascending: false }))
          : Promise.resolve([]),
      ]);
      setSummary(s);
      setExpenses(e as Expense[]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [householdId, year, month, withExpenses]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  return { summary, expenses, loading, error, reload };
}

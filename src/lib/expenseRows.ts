import { parseAmount, toPaise, validateExpense, type ExpenseInput, type ValidExpense } from './format';

/** Remembers the last category used, as the default for the next expense. */
export const LAST_CATEGORY_KEY = 'het-last-category';

/** Most rows one save can hold. Keeps the screen manageable on a phone. */
export const MAX_ROWS = 20;

export interface Row extends ExpenseInput { key: number }
export type RowErrors = Partial<Record<keyof ExpenseInput, string>>;

let nextKey = 1;

export const blankRow = (defaults: Pick<ExpenseInput, 'categoryId' | 'date' | 'paidBy'>): Row =>
  ({ key: nextKey++, amount: '', description: '', note: '', ...defaults });

/** A new row starts with the previous row's category, date and payer: a shopping trip is usually one day, one payer. */
export const rowAfter = (prev: Row): Row => blankRow({ categoryId: prev.categoryId, date: prev.date, paidBy: prev.paidBy });

/** A row the person never typed into. Extra blank rows are skipped on save instead of blocking it. */
export const isBlank = (r: ExpenseInput) => !r.amount.trim() && !r.description.trim() && !r.note.trim();

export type RowsResult =
  | { ok: true; values: ValidExpense[]; errors: RowErrors[] }
  | { ok: false; error: string; errors: RowErrors[] };

/** Validates every row; blank rows are ignored unless every row is blank. */
export function validateRows(rows: ExpenseInput[], today: string): RowsResult {
  const errors: RowErrors[] = rows.map(() => ({}));
  const filled = rows.map((r, i) => ({ r, i })).filter(({ r }) => !isBlank(r));
  if (filled.length === 0) {
    errors[0] = { amount: 'Enter an amount.', description: 'Enter a description.' };
    return { ok: false, error: 'Fill in at least one expense.', errors };
  }
  const values: ValidExpense[] = [];
  let bad = 0;
  for (const { r, i } of filled) {
    const v = validateExpense(r, today);
    if (v.ok) values.push(v.value);
    else { errors[i] = v.errors ?? {}; bad++; }
  }
  if (bad) {
    const which = filled.filter(({ i }) => Object.keys(errors[i]).length).map(({ i }) => i + 1);
    return { ok: false, error: `Please fix the highlighted fields in expense ${which.join(', ')}.`, errors };
  }
  return { ok: true, values, errors };
}

/** Running total of the rows whose amount is valid, in paise. */
export const rowsTotalPaise = (rows: ExpenseInput[]) =>
  rows.reduce((sum, r) => {
    const a = parseAmount(r.amount);
    return a.ok ? sum + toPaise(a.value) : sum;
  }, 0);

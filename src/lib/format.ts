const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,25,000.00 from integer paise. */
export const formatPaise = (paise: number) => inr.format(paise / 100);

/** ₹1,25,000.00 from a rupee amount as returned by Postgres numeric (string or number). */
export const formatRupees = (rupees: number | string) => formatPaise(toPaise(rupees));

export const toPaise = (rupees: number | string) => Math.round(Number(rupees) * 100);

export const MAX_AMOUNT = 10_000_000;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Accepts "1,250", "₹1,250.5", "1250.50". Returns a normalised "1250.50" string for Postgres numeric. */
export function parseAmount(input: string): Result<string> {
  const cleaned = input.replace(/[₹,\s]/g, '');
  if (!cleaned) return { ok: false, error: 'Enter an amount.' };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { ok: false, error: 'Use numbers only, with up to 2 decimal places.' };
  const paise = Math.round(Number(cleaned) * 100);
  if (paise <= 0) return { ok: false, error: 'Amount must be more than zero.' };
  if (paise > MAX_AMOUNT * 100) return { ok: false, error: 'Amount is too large.' };
  return { ok: true, value: (paise / 100).toFixed(2) };
}

export interface ExpenseInput {
  amount: string;
  description: string;
  categoryId: string;
  date: string;
  paidBy: string;
  note: string;
}

export interface ValidExpense {
  amount: string;
  description: string;
  category_id: string;
  expense_date: string;
  paid_by: string;
  note: string | null;
}

/** Client-side mirror of the database checks, for instant feedback. The database re-validates. */
export function validateExpense(input: ExpenseInput, today = istToday()): Result<ValidExpense> & { errors?: Partial<Record<keyof ExpenseInput, string>> } {
  const errors: Partial<Record<keyof ExpenseInput, string>> = {};
  const amount = parseAmount(input.amount);
  if (!amount.ok) errors.amount = amount.error;
  const description = input.description.trim();
  if (!description) errors.description = 'Enter a description.';
  else if (description.length > 120) errors.description = 'Keep it under 120 characters.';
  if (!input.categoryId) errors.categoryId = 'Pick a category.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) errors.date = 'Pick a date.';
  else if (input.date > today) errors.date = 'Date cannot be in the future.';
  if (!input.paidBy) errors.paidBy = 'Choose who paid.';
  const note = input.note.trim();
  if (note.length > 500) errors.note = 'Keep the note under 500 characters.';

  if (Object.keys(errors).length || !amount.ok) {
    return { ok: false, error: 'Please fix the highlighted fields.', errors };
  }
  return {
    ok: true,
    value: {
      amount: amount.value,
      description,
      category_id: input.categoryId,
      expense_date: input.date,
      paid_by: input.paidBy,
      note: note || null,
    },
  };
}

// ---- Dates (household runs on Asia/Kolkata) ----

export const TZ = 'Asia/Kolkata';

/** Today as YYYY-MM-DD in IST. */
export function istToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

export interface YearMonth {
  year: number;
  month: number; // 1-12
}

export function currentMonth(now = new Date()): YearMonth {
  const [y, m] = istToday(now).split('-').map(Number);
  return { year: y, month: m };
}

export const monthKey = ({ year, month }: YearMonth) => `${year}-${String(month).padStart(2, '0')}`;

export function parseMonthKey(key: string | null | undefined): YearMonth | null {
  const m = key?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export const compareMonths = (a: YearMonth, b: YearMonth) => a.year * 12 + a.month - (b.year * 12 + b.month);

export function monthLabel({ year, month }: YearMonth): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function monthRange({ year, month }: YearMonth): { from: string; to: string } {
  const next = addMonths({ year, month }, 1);
  return { from: `${monthKey({ year, month })}-01`, to: `${monthKey(next)}-01` };
}

/** "Today", "Yesterday" or "Mon, 3 Nov". */
export function dayLabel(date: string, today = istToday()): string {
  if (date === today) return 'Today';
  const y = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  if (date === y) return 'Yesterday';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function dateTimeLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ });
}

export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

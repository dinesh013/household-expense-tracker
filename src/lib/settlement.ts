import type { Payment } from './types';

/** Paid in full at the current figure (a reopen + recalculation can change what's owed). */
export const isSettled = (p: Payment) => p.paid_on !== null && p.paid_amount_paise === p.amount_paise;

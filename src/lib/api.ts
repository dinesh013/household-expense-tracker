import { supabase } from './supabase';

/** Turn database errors into something a person can act on. */
export function friendlyError(message: string): string {
  if (/row-level security|permission denied/i.test(message)) return 'You do not have permission to do that.';
  if (/categories_unique_name/i.test(message)) return 'A category with that name already exists.';
  if (/amount_check|expenses_amount/i.test(message)) return 'Amount must be more than zero.';
  if (/Failed to fetch|NetworkError/i.test(message)) return 'Could not reach the server. Check your connection and try again.';
  return message;
}

type DbResult<T> = { data: T | null; error: { message: string } | null };

/** Await a Supabase query and throw a friendly Error on failure. */
export async function must<T>(query: PromiseLike<DbResult<T>>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(friendlyError(error.message));
  return data as T;
}

export function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  return must<T>(supabase.rpc(fn, args) as unknown as PromiseLike<DbResult<T>>);
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

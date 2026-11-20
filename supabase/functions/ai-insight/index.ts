// Supabase Edge Function: POST { household_id, year, month } -> { id, content: Insight }.
// Runs with the caller's own login (their JWT), so RLS decides what data it can read.
// Needs the secret ANTHROPIC_API_KEY (Supabase → Edge Functions → Secrets). Without it, it answers
// 503 { code: "not_configured" } and the app shows "AI Insight isn't switched on yet".
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { dataRange, generateInsight, InsightError, summarise, type Ym } from './insight.ts';

const CORS = {
  // Bearer-token auth (no cookies), so any origin is safe; set ALLOWED_ORIGIN to lock it to the app's URL.
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) => json(status, { code, message });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** What to tell the person when the Claude call fails. Details go to the function log only. */
function friendly(err: unknown): string {
  if (err instanceof InsightError) return err.message;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return 'The AI key was rejected. The Owner needs to check the ANTHROPIC_API_KEY secret.';
  }
  if (err instanceof Anthropic.RateLimitError) return 'The AI is busy right now. Try again in a minute.';
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI service. Try again.";
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return 'The AI service had a problem. Try again shortly.';
  return 'Something went wrong while writing the insight.';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail(405, 'method', 'Use POST.');

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return fail(503, 'not_configured', "AI Insight isn't switched on yet. The Owner needs to add an Anthropic API key.");

  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return fail(401, 'auth', 'Please sign in again.');

  let ym: Ym;
  let householdId: string;
  try {
    const b = await req.json();
    householdId = String(b.household_id ?? '');
    ym = { year: Number(b.year), month: Number(b.month) };
    if (!UUID.test(householdId) || !Number.isInteger(ym.year) || !Number.isInteger(ym.month) || ym.month < 1 || ym.month > 12) throw new Error();
  } catch {
    return fail(400, 'bad_request', 'Invalid request.');
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  // Reserve one of today's slots first, so a failed or slow call can't be used to bypass the limit.
  const claim = await db.rpc('claim_ai_insight', { p_household: householdId, p_year: ym.year, p_month: ym.month });
  if (claim.error) {
    const limit = /AI Insights/.test(claim.error.message);
    return fail(limit ? 429 : 403, limit ? 'limit' : 'forbidden', limit ? claim.error.message : 'You are not a member of this household.');
  }
  const insightId = claim.data as string;

  try {
    const { from, to } = dataRange(ym);
    const [cats, exps, people] = await Promise.all([
      db.from('categories').select('id, name').eq('household_id', householdId).order('sort_order'),
      db.from('expenses').select('amount, category_id, expense_date').eq('household_id', householdId).gte('expense_date', from).lt('expense_date', to),
      db.from('household_members').select('user_id', { count: 'exact', head: true }).eq('household_id', householdId).in('role', ['owner', 'member']).is('removed_at', null),
    ]);
    if (cats.error || exps.error || people.error) throw new Error(`load failed: ${(cats.error ?? exps.error ?? people.error)!.message}`);

    const input = summarise(exps.data, cats.data, ym, people.count ?? 1, istToday());
    if (input.categories.every((c) => c.this_month === 0)) throw new InsightError('Add a few expenses for this month first.');

    // Prices are per token; only category totals, the month and the head-count are sent. No names or notes.
    const anthropic = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
    const insight = await generateInsight((params) => anthropic.beta.messages.create(params), input);

    const saved = await db.rpc('complete_ai_insight', { p_id: insightId, p_content: insight, p_error: null });
    if (saved.error) throw new Error(`save failed: ${saved.error.message}`);
    return json(200, { id: insightId, content: insight });
  } catch (err) {
    console.error('ai-insight failed', err instanceof Error ? err.message : err);
    const message = friendly(err);
    await db.rpc('complete_ai_insight', { p_id: insightId, p_content: null, p_error: message });
    return fail(502, 'failed', message);
  }
});

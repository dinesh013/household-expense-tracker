# Household Expense Tracker: project context

Mobile-first shared household expense tracker: React 19 + TS + Vite frontend talking **directly** to
Supabase (anon key + RLS). There is no app server. Business rules live in Postgres.

## Layout
- `supabase/migrations/*.sql`: the whole backend, applied in filename order.
  - `0001` tables · `0002` role helpers, validation trigger (`expenses_guard`), edit-history trigger
  - `0003` `compute_settlement` (paise maths), `get_month_summary`, Owner-only close/reopen (Paid marks kept and
    carried over on re-close), mark-paid, household + invite-link RPCs (`create_invite`, `get_invite`, `accept_invite`)
  - `0004` RLS policies + column-scoped grants + EXECUTE grants. No scheduled job: only the Owner closes months.
  - `0005` Owner-only `reorder_categories`, `delete_category` (moves expenses, refused for closed months), `category_usage`.
  - `0006` activity log: `expense_history` keeps entries after an expense is deleted (FK dropped), adds `deleted`
    entries, a `snapshot` of the expense per entry and a `seq` identity for exact order (sort by `seq`, not `changed_at`).
  - `0007` expense update/delete Owner-only (RLS); `change_requests` + `request_expense_change`, `cancel_change_request`,
    `decide_change_request` (approve applies the edit/delete as the Owner; reject needs a reason).
  - `0008` `ai_insights` + `claim_ai_insight` / `complete_ai_insight` (5 a day per household, IST).
- `supabase/functions/ai-insight/`: Edge Function (Deno). `index.ts` = IO; `insight.ts` = pure logic (prompt, tool schema,
  validation, pause_turn loop) shared with `tests/insight.test.ts` and the fake server. Typechecked via
  `tsconfig.functions.json` (`@anthropic-ai/sdk` is a devDependency for types; Deno resolves via `deno.json`).
- `src/lib/`: `supabase.ts` client, `session.tsx` (auth + household context: `useApp()`), `useMonth.ts`
  (month from `?m=YYYY-MM` + summary/expenses), `format.ts` (₹ en-IN formatting, amount parsing, client
  validation, IST dates), `api.ts` (`must`/`rpc` + friendly errors), `types.ts`.
- `src/pages/`: Dashboard, AddExpenses (`/expenses/new`, one or several rows in one insert; helpers in `lib/expenseRows.ts`),
  ExpenseForm (edit/history), Settlement, `settings/Activity` (audit log, pages by `seq`; helpers in `lib/activity.ts`), Login (password only, no email features),
  Welcome (join via stored/pasted invite link, or create household), Join (`/join/:token`), `settings/` (Access, Categories, Activity, Profile).
- `src/lib/invite.ts`: invite token parsing + localStorage hand-off from `/join/:token` through sign-up.
- `tests/sql.test.mjs`: scenario tests on PGlite with `tests/supabase_stub.sql` (fake `auth` schema/roles).
- `tests/fake-supabase.mjs`: dev-only fake Supabase (auth + PostgREST subset) over PGlite with seed data.

## Rules
- **After any change run:** `npm run typecheck && npm test && npm run test:sql && npm run build`. All must be green.
- Any new table needs RLS enabled, policies, and explicit grants in a **new** migration file. Don't edit
  applied migrations once a real project exists.
- New client-callable functions must be `security definer set search_path = public`, check the caller's role
  themselves, and be added to the `grant execute` list. Internal helpers stay revoked.
- Money: integer paise in settlement JSON (`*_paise`), `numeric(12,2)` in tables. Format only via `format.ts`.
- Month boundaries and "today" are always Asia/Kolkata (`ist_today()` in SQL, `istToday()` in TS).
- Never put the service_role key in the frontend or `.env`. Only `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

## Dev
- Real backend: `.env` from `.env.example`, then `npm run dev` (port 5174). Supabase "Confirm email" must be OFF.
- Offline: `npm run fake-supabase` + `npm run dev:fake` (uses `.env.fake`). Seed users are in the fake server file.
- The fake server supports only the PostgREST features the app uses (eq/gte/lt/is filters, order, limit/offset, one-level
  embed, insert/update/delete, rpc) plus a canned `/functions/v1/ai-insight` (`FAKE_AI=off` mimics "not set up"). Extend it if you add new query shapes.

## Product decisions (from the user, 2026-11-18)
- The Owner (the user) is the only admin: invite links, roles, removal, categories, close/reopen are Owner-only.
- Invites are links the Owner shares manually. No emails anywhere (no magic link, no confirmation, no invite email).
- No month-end job. Months close only when the Owner clicks Close.
- Reopening must not clear Paid marks.
- Mark-as-paid is allowed for the payer, the receiver and the Owner (confirmed by the user).
- (2026-11-19) Adding several expenses at once: Owner and Members. Reorder/delete categories: Owner only.
  Deleting a used category moves its expenses to one the Owner picks; refused while any is in a closed month.
- (2026-11-19) Activity log (who added/edited/deleted which expense, when, how much, for which date) under
  Settings → Activity, readable by everyone in the household (Viewers too).
- (2026-11-20) Members can add but not edit/delete expenses; they raise change requests. Owner approve = applied
  automatically; reject needs a reason.
- (2026-11-20) AI Insight: anyone in the household, 5/day/household. The user chose **no paid API for now**: the
  function is built but needs `ANTHROPIC_API_KEY` + deploy (README "AI Insight"); until then the card says it's off.
  Locality is fixed to Velachery, Chennai (`LOCALITY` in insight.ts). Model `claude-opus-5-5`, effort low,
  web search max 3, server-side fallback "default".

## Status (2026-11-18)
- Verified offline: 46 SQL scenario tests, 37 unit tests, build, and a browser walkthrough on the fake backend
  (link sign-up → join, reused link refused, link creation, mark paid → reopen → edit → re-close with carried mark).

## Status (2026-11-19): live
- Running on a real Supabase project, hosted on Vercel. Vercel auto-deploys every push to `main`
  (GitHub `dinesh013/household-expense-tracker`). Env vars `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are set in Vercel.
- The migrations are applied to the real project: **never edit `0001`–`0005`** (0005 applied 2026-11-19). `0006` applied 2026-11-19. `0007` + `0008` must be run in the SQL Editor before their frontend is pushed. Schema changes go in a new
  migration file, run in the Supabase SQL Editor **before** pushing frontend code that depends on it.
- Vercel Hobby only deploys commits whose author email it can match to `dinesh013`. If a deploy shows
  "Blocked", check the commit email (`git log -1 --format=%ae`) is linked to that GitHub account.

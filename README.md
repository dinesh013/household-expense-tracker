# Household Expense Tracker

A mobile-first web app for a small household (usually 2 people) to log shared expenses and see,
at any time, who owes whom. Once a calendar month (Asia/Kolkata) has ended, the Owner closes it: the
final settlement is frozen and the month's expenses are locked.

- **Frontend:** React 19 + TypeScript + Vite (static site, no server of its own)
- **Backend:** Supabase: Auth (email + password), Postgres with Row Level Security, and RPC functions
- **Money:** Indian Rupees, formatted `₹1,25,000.00`; all settlement maths runs in integer paise

## Screens

| Screen | What it does |
| --- | --- |
| **Dashboard** (`/`) | Month selector, total spent, each person's paid/share/balance, interim (or final) settlement, category donut, **AI Insight** (optional, see below), and an expense list grouped by day with search and person/category filters. Floating **Add expense** button. The Owner sees a banner when change requests are waiting. |
| **Add expenses** | One expense, or several in one save (**Add another expense**, up to 20). Each new row copies the previous row's category, date and payer. Blank extra rows are skipped; if any row is invalid nothing is saved. Owner and Members. |
| **Expense** (`/expenses/:id`) | Amount, description, category, date, paid by, optional note. Shows **Logged by** and **Paid by** separately, plus the edit history. **Only the Owner edits or deletes.** Members see it read-only with **Request a change** (correct the fields + reason) and **Request deletion**; the Owner approves or rejects right there. Read-only for Viewers and closed months. |
| **Settlement** (`/settlement`) | Who pays whom, a per-person breakdown, **Mark as paid** (with date), and Owner-only **Close** / **Reopen**. |
| **Settings** | **Access** (create/share invite links, set roles, remove, pending links), **Categories** (Owner adds, renames, reorders and deletes), **Activity** (change requests waiting for the Owner and recent decisions, then the audit log: who added, edited or deleted which expense and when, with the amount and date; filter by person and type; everyone in the household can see it), **Profile** (name, household name, sign out, leave). |

## Set up Supabase (one time)

1. Create a project at supabase.com. Pick the Mumbai region (`ap-south-1`) for Indian users.
2. Run the migrations **in order** in the SQL Editor, or use `supabase db push` with the Supabase CLI:
   ```
   supabase/migrations/20261118000001_schema.sql
   supabase/migrations/20261118000002_helpers_triggers.sql
   supabase/migrations/20261118000003_settlement_rpc.sql
   supabase/migrations/20261118000004_rls.sql
   supabase/migrations/20261119000005_category_order_delete.sql
   supabase/migrations/20261119000006_activity_log.sql
   supabase/migrations/20261120000007_change_requests.sql
   supabase/migrations/20261120000008_ai_insights.sql
   ```
3. **Authentication → Sign In / Providers → Email:** keep Email enabled and switch **"Confirm email" off**. The app
   doesn't use email at all (no magic links, no confirmations), so with confirmation on, new people couldn't
   finish signing up.
4. **Authentication → URL Configuration:** set **Site URL** to where the app is hosted (e.g. `http://localhost:5174`
   in dev). Invite links are built from the address you open the app at, so share links from the deployed URL.
5. Sign up in the app yourself first and create the household. That makes you the Owner.

## Run the app

```bash
cp .env.example .env    # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Project Settings → API)
npm install
npm run dev             # http://localhost:5174
```

Only the **anon / publishable** key goes in `.env`. It is meant to be public, and RLS protects the data.
**Never** put the `service_role` / secret key in the frontend or commit `.env`.

### Try it offline (no Supabase account needed)

`tests/fake-supabase.mjs` is a dev-only stand-in. It runs the **real migrations** in an in-process Postgres
(PGlite) with RLS enforced, and answers the auth and REST calls the app makes. It also seeds a household
with two months of data.

```bash
npm run fake-supabase   # terminal 1: 127.0.0.1:54329
npm run dev:fake        # terminal 2: http://localhost:5174
```

Seed accounts: `arun@` (Owner), `priya@` (Member), `vik@` (Viewer) and `newbie@` (not in a household yet), all
`@example.com`. The server prints a ready-to-use invite link on start-up. The shared password is `SEED_PASSWORD` in that file. Data resets on restart. Tokens are
unsigned, so never expose this server.

## Tests

```bash
npm test              # unit tests: ₹ formatting, amount parsing, validation, IST month maths,
                      # change requests, AI Insight logic (with a fake Claude client, no API calls)
npm run test:sql      # 46 scenario tests against the real migrations: RLS, roles, validation,
                      # settlement maths, close/lock/reopen, kept Paid marks, invite links, activity log,
                      # Members add-only + change requests, AI Insight daily limit
npm run typecheck     # the app and the Edge Function
npm run build
```

## Deploy

`npm run build` produces a static site in `dist/`. Host it on Vercel, Netlify, Cloudflare Pages or S3 +
CloudFront. Set the two `VITE_` variables in the host's environment settings, and add an **SPA fallback**
(serve `index.html` for unknown paths) so deep links like `/settlement?m=2026-10` work. Then add the
deployed URL to Supabase's Site URL.

## How the settlement works

Calculated in Postgres (`compute_settlement`), so every user sees the same result:

1. **Participants** are Owner and Member accounts active at any point in that month. Viewers are excluded.
2. **Total** is the sum of the month's expenses, in paise.
3. **Fair share** is Total ÷ participants. Leftover paise after integer division go 1 paisa each to the
   earliest-joined participants, so shares always add up to the exact total.
4. **Balance** is what a person paid minus their fair share. Positive means they get money back.
5. **Payments:** the largest debtor pays the largest creditor, repeated until everyone is settled. This uses
   at most *people − 1* payments, and exactly one for two people.

**Month end:** nothing happens automatically. After a month ends it shows "Waiting for Owner to close". When the
Owner closes it, the settlement is frozen, its payment rows are created, and the database rejects edits to that
month. The Owner can **reopen** a month to fix something and **close** it again to recalculate. **Paid marks are
kept**: on re-close each mark is matched to the same payer → receiver pair with the amount actually paid. If the
new figure differs, the app shows what is still to pay or what should be returned.

## AI Insight (optional)

The **✨ AI Insight** card on the dashboard names the category you overspend on most this month, gives 2–3 short
tips, and ends with a light-hearted line comparing you with a typical Velachery (Chennai) household. A Supabase
Edge Function (`supabase/functions/ai-insight`) calls Claude (`claude-opus-5-5`, low effort) with live web search
for current Chennai figures. Until it is set up, the card says *"AI Insight isn't switched on yet"*.

- **Who:** anyone in the household, up to **5 a day per household** (IST), enforced in the database. The latest
  insight for the month is shown to everyone.
- **What is sent:** this month's and the last 3 months' category totals, the month, and how many people share
  them. No names, emails, descriptions or notes.
- **Cost:** pay-as-you-go on your Anthropic account, roughly US$0.05–0.15 per insight with web search
  (an estimate: check your usage page after the first few). Set a monthly spend limit in the Anthropic Console.
- If the model declines a request, server-side fallback (`fallbacks: "default"`) retries it on another model.

To switch it on:

1. Run migrations `0007` and `0008` (above) if you haven't.
2. Create an API key at <https://console.anthropic.com> (Settings → API keys) and set a spend limit.
3. Supabase Dashboard → **Edge Functions → Secrets**: add `ANTHROPIC_API_KEY`. Optionally add `ALLOWED_ORIGIN`
   with your Vercel URL (e.g. `https://your-app.vercel.app`) to accept calls only from the app.
4. Deploy the function from the project folder (needs the Supabase CLI login once):
   ```bash
   npx supabase login
   npx supabase functions deploy ai-insight --project-ref <your-project-ref>
   ```
   The project ref is the `xxxx` in `https://xxxx.supabase.co`. Never put the API key in `.env` or the frontend.

## Security

- RLS is enabled on **every** table. Members read only their household's data. Expense writes need the Owner
  or Member role.
- **Members add, never edit or delete.** Editing and deleting expenses is Owner-only in RLS, so a Member's direct
  API call changes nothing. Members raise a change request instead; only the Owner can approve (which applies it,
  through the same validation and closed-month lock) or reject it (with a reason).
- **AI Insight** runs with the caller's own login, so it reads only data RLS allows. The API key lives only in
  Supabase's Edge Function secrets. Source links are limited to `https://` URLs. A household member could save an
  insight text of their own via the RPC; it is always shown with their name.
- **Owner-only (admin) actions:** create/cancel invite links, change roles, remove people, add/rename/reorder/delete categories,
  edit/delete expenses, approve/reject change requests,
  rename the household, and close/reopen months. Each goes through a `security definer` RPC or an RLS policy
  that checks the caller is the Owner, so the database itself enforces it, not just the UI.
- Invite links carry a 64-hex-character random token. They work **once**, expire after **7 days**, and can be
  cancelled. Only the Owner can read tokens. Anyone holding a valid link can join with the role it grants, so
  share links privately.
- Writes are restricted to specific columns: clients cannot set `logged_by`, `household_id` on update, or any
  settlement data.
- Validation happens in both places. The client gives instant feedback, and the database re-checks with
  constraints and triggers: amount > 0 and ≤ ₹1 crore, description required, no future dates, category must
  belong to the household, payer must be an active Owner/Member, and closed months are locked.
- Internal functions (`compute_settlement`, `close_month_internal`, `expense_snapshot`) are not callable by clients.
- The activity log (`expense_history`) is written only by a database trigger. Clients can read their household's
  log but can't insert, change or delete entries, so it can't be edited after the fact.

## Design decisions and assumptions

- **One household per person.** Each account belongs to one household at a time, which keeps every screen
  simple. A Member can leave and then join another household. The Owner can't leave.
- **Invites are links you share yourself.** No emails are sent. The person opens the link, creates an account
  (or signs in) and taps **Join**. They can also paste the link on the welcome screen.
- **Marking a payment as paid** can be done by the payer, the receiver or the Owner.
- **Deleting a category** moves its expenses to a category the Owner picks (each move shows in that expense's edit
  history). It is refused while any of those expenses is in a closed month, so a final settlement never changes; reopen
  the month first or rename the category instead. The last category can't be deleted.
- **Activity log** lives under Settings and is visible to every member, Viewers included, so the household can see
  who logged what. It records adds, edits and deletes of expenses. Each entry keeps a snapshot of the expense at that
  moment (amount, date, category, payer, note), so a deleted expense still shows what was removed.
- **Role changes apply to open months.** Promoting a Viewer to Member includes them in the current month's
  split. Closed months keep their frozen snapshot.
- **Removed members** are soft-removed. They lose access straight away but stay in the split for months they
  were active in, and their past expenses remain.
- **Expense dates can't be in the future.** Expenses backdated to before anyone joined are split among the
  household's founding Owner/Members (those who joined in its first month). People who join later are never
  added to earlier months.
- **No password reset.** It would need email. If someone forgets their password, reset it from the Supabase
  dashboard (Authentication → Users).
- **Out of scope** (as requested): unequal splits, multiple currencies, receipt scanning, bank integrations,
  and payment processing.

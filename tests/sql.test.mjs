// Runs the real migrations on an in-process Postgres (PGlite) with a Supabase auth stub,
// then exercises RLS, validation, settlement maths and month close/reopen.
// Usage: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();
let passed = 0;
let failed = 0;

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const canon = (v) => JSON.stringify(v, (_, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x);
const eq = (a, b, msg) => assert(canon(a) === canon(b), `${msg}: expected ${canon(b)}, got ${canon(a)}`);

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok   ', name);
  } catch (e) {
    failed++;
    console.log('  FAIL ', name, '\n        ', e.message);
  } finally {
    await db.exec('reset role');
  }
}

async function as(user) {
  await db.exec('reset role');
  await db.query(
    "select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.email', $2, false)",
    [user?.id ?? '', user?.email ?? ''],
  );
  await db.exec(user ? 'set role authenticated' : 'set role anon');
}

async function service() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.email', '', false)");
}

async function expectError(fn, pattern) {
  try {
    await fn();
  } catch (e) {
    assert(pattern.test(e.message), `unexpected error: ${e.message}`);
    return;
  }
  throw new Error(`expected an error matching ${pattern}`);
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const rpc = async (fn, ...args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return (await db.query(`select public.${fn}(${ph}) as r`, args)).rows[0].r;
};

// Dates in IST
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const [ty, tm] = today.split('-').map(Number);
const prevY = tm === 1 ? ty - 1 : ty;
const prevM = tm === 1 ? 12 : tm - 1;
const prevDate = `${prevY}-${String(prevM).padStart(2, '0')}-15`;
const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);

const arun = { id: '11111111-1111-1111-1111-111111111111', email: 'arun@example.com', name: 'Arun' };
const priya = { id: '22222222-2222-2222-2222-222222222222', email: 'priya@example.com', name: 'Priya' };
const vik = { id: '33333333-3333-3333-3333-333333333333', email: 'vik@example.com', name: 'Vik' };
const outsider = { id: '44444444-4444-4444-4444-444444444444', email: 'out@example.com', name: 'Out' };

console.log('Loading migrations…');
await db.exec(readFileSync(join(root, 'tests/supabase_stub.sql'), 'utf8'));
const migDir = join(root, 'supabase/migrations');
for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(migDir, f), 'utf8'));
}
for (const u of [arun, priya, vik, outsider]) {
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
    u.id, u.email, { display_name: u.name },
  ]);
}

let hid;
let catId;
const insertExpense = (amount, description, paidBy, date = today, extra = {}) =>
  db.query(
    `insert into public.expenses (household_id, amount, description, category_id, expense_date, paid_by, note)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [hid, amount, description, extra.category ?? catId, date, paidBy, extra.note ?? null],
  );

console.log('\nHousehold & access');
await check('signup creates a profile from metadata', async () => {
  const p = await one('select display_name, email from public.profiles where id = $1', [arun.id]);
  eq(p, { display_name: 'Arun', email: 'arun@example.com' }, 'profile');
});
await check('owner creates household with 9 default categories', async () => {
  await as(arun);
  hid = await rpc('create_household', 'Home');
  const c = await one('select count(*)::int as n, min(id::text) as any from public.categories where household_id = $1', [hid]);
  eq(c.n, 9, 'category count');
  catId = (await one("select id from public.categories where household_id = $1 and name = 'Groceries'", [hid])).id;
  eq(await rpc('household_role', hid), 'owner', 'role');
});
await check('cannot create a second household', async () => {
  await as(arun);
  await expectError(() => rpc('create_household', 'Second'), /already belong/);
});
let priyaToken;
let vikToken;
await check('owner creates invite links; bad role rejected', async () => {
  await as(arun);
  priyaToken = await rpc('create_invite', hid, 'member', ' Priya ');
  vikToken = await rpc('create_invite', hid, 'viewer', null);
  assert(/^[0-9a-f]{64}$/.test(priyaToken), `token shape ${priyaToken}`);
  assert(priyaToken !== vikToken, 'tokens differ');
  eq((await one('select label from public.household_invites where token = $1', [priyaToken])).label, 'Priya', 'label trimmed');
  await expectError(() => rpc('create_invite', hid, 'owner', null), /Member or Viewer/);
});
await check('link holder sees the invite and joins with it', async () => {
  await as(priya);
  const info = (await db.query('select * from public.get_invite($1)', [priyaToken])).rows[0];
  eq(info, { household_name: 'Home', role: 'member', invited_by_name: 'Arun', state: 'valid' }, 'invite info');
  eq((await db.query('select * from public.get_invite($1)', ['nope'])).rows.length, 0, 'unknown token');
  await rpc('accept_invite', priyaToken);
  eq(await rpc('household_role', hid), 'member', 'priya role');
  await as(vik);
  await rpc('accept_invite', vikToken);
  eq(await rpc('household_role', hid), 'viewer', 'vik role');
});
await check('invite links are single use, expire and can be cancelled', async () => {
  await as(outsider);
  eq((await db.query('select state from public.get_invite($1)', [priyaToken])).rows[0].state, 'accepted', 'used state');
  await expectError(() => rpc('accept_invite', priyaToken), /already been used/);
  await expectError(() => rpc('accept_invite', 'not-a-token'), /not valid/);
  await as(arun);
  const t1 = await rpc('create_invite', hid, 'member', null);
  const t2 = await rpc('create_invite', hid, 'member', null);
  const id1 = (await one('select id from public.household_invites where token = $1', [t1])).id;
  await rpc('cancel_invite', id1);
  await service();
  await db.query("update public.household_invites set expires_at = now() - interval '1 minute' where token = $1", [t2]);
  await as(outsider);
  await expectError(() => rpc('accept_invite', t1), /not valid/);
  eq((await db.query('select state from public.get_invite($1)', [t2])).rows[0].state, 'expired', 'expired state');
  await expectError(() => rpc('accept_invite', t2), /expired/);
  eq((await one('select count(*)::int as n from public.households')).n, 0, 'outsider still outside');
});
await check('someone already in a household cannot join another', async () => {
  await as(arun);
  const t = await rpc('create_invite', hid, 'member', null);
  await as(priya);
  await expectError(() => rpc('accept_invite', t), /already belong/);
  await as(arun);
  await rpc('cancel_invite', (await one('select id from public.household_invites where token = $1', [t])).id);
});
await check('only the owner creates or cancels invite links', async () => {
  await as(priya);
  await expectError(() => rpc('create_invite', hid, 'member', null), /Only the Owner/);
  eq((await one('select count(*)::int as n from public.household_invites')).n, 0, 'member cannot read invites/tokens');
  await as(null);
  await expectError(() => db.query("select * from public.get_invite('x')"), /permission denied/);
});
await check('outsider sees nothing and cannot write', async () => {
  await as(outsider);
  eq((await one('select count(*)::int as n from public.households')).n, 0, 'households');
  eq((await one('select count(*)::int as n from public.household_members')).n, 0, 'members');
  await expectError(() => rpc('get_month_summary', hid, ty, tm), /not a member/);
  await expectError(() => insertExpense(10, 'Hack', outsider.id), /row-level security|permission to add/);
});
await check('anon role has no table access', async () => {
  await as(null);
  await expectError(() => db.query('select * from public.expenses'), /permission denied/);
});
await check('profiles visible only to co-members', async () => {
  await as(arun);
  eq((await one('select count(*)::int as n from public.profiles')).n, 3, 'arun sees household profiles');
  await as(outsider);
  eq((await one('select count(*)::int as n from public.profiles')).n, 1, 'outsider sees only self');
});

console.log('\nExpenses & validation');
await check('members log expenses; logged_by is set server-side', async () => {
  await as(arun);
  await insertExpense('1000.00', 'Rent share', arun.id);
  await as(priya);
  await insertExpense('333.33', 'Vegetables', priya.id);
  const r = (await insertExpense('0.01', 'Tip (for Arun)', arun.id)).rows[0];
  eq(r.logged_by, priya.id, 'logged_by');
  eq(r.paid_by, arun.id, 'paid_by');
});
await check('client cannot set logged_by directly', async () => {
  await as(priya);
  await expectError(
    () => db.query(
      'insert into public.expenses (household_id, amount, description, category_id, paid_by, logged_by) values ($1, 5, $2, $3, $4, $4)',
      [hid, 'Spoof', catId, arun.id]),
    /permission denied/);
});
await check('invalid inputs are rejected by the database', async () => {
  await as(priya);
  await expectError(() => insertExpense('0', 'Zero', priya.id), /check constraint|violates/);
  await expectError(() => insertExpense('-5', 'Negative', priya.id), /check constraint|violates/);
  await expectError(() => insertExpense('10', '   ', priya.id), /Description is required|check constraint/);
  await expectError(() => insertExpense('10', 'Future', priya.id, tomorrow), /future/);
  await expectError(() => insertExpense('10', 'Viewer paid', vik.id), /Owner or Member/);
});
await check('viewer can read but not write', async () => {
  await as(vik);
  eq((await one('select count(*)::int as n from public.expenses')).n, 3, 'viewer reads');
  await expectError(() => insertExpense('10', 'Viewer add', priya.id), /row-level security|permission to add/);
  await db.query('delete from public.expenses');
  eq((await one('select count(*)::int as n from public.expenses')).n, 3, 'delete silently filtered');
});
await check('interim settlement: equal split, exact paise, one payment', async () => {
  await as(vik);
  const s = await rpc('get_month_summary', hid, ty, tm);
  eq(s.status, 'open', 'status');
  eq(s.is_current, true, 'is_current');
  eq(s.total_paise, 133334, 'total');
  eq(s.participant_count, 2, 'viewers excluded');
  const byId = Object.fromEntries(s.people.map((p) => [p.user_id, p]));
  eq([byId[arun.id].paid_paise, byId[arun.id].share_paise, byId[arun.id].balance_paise], [100001, 66667, 33334], 'arun');
  eq([byId[priya.id].paid_paise, byId[priya.id].share_paise, byId[priya.id].balance_paise], [33333, 66667, -33334], 'priya');
  eq(s.transfers, [{ from: priya.id, to: arun.id, amount_paise: 33334 }], 'transfers');
});
await check('odd paisa goes to one person and balances sum to zero', async () => {
  await as(arun);
  await insertExpense('0.01', 'Odd paisa', arun.id);
  const s = await rpc('get_month_summary', hid, ty, tm);
  eq(s.total_paise, 133335, 'total');
  eq(s.people.map((p) => p.share_paise).sort(), [66667, 66668], 'shares');
  eq(s.people.reduce((a, p) => a + p.balance_paise, 0), 0, 'balance sum');
  eq(s.people.reduce((a, p) => a + p.share_paise, 0), 133335, 'share sum');
});
await check('edits are recorded in history; household and logged_by immutable', async () => {
  await as(priya);
  const e = (await db.query("update public.expenses set amount = 1200, note = 'revised' where description = 'Rent share' returning *")).rows[0];
  eq(e.logged_by, arun.id, 'logged_by kept');
  const h = (await db.query("select action, changed_by, changes from public.expense_history where expense_id = $1 order by changed_at", [e.id])).rows;
  eq(h.map((x) => x.action), ['created', 'updated'], 'history actions');
  eq(h[1].changed_by, priya.id, 'changed_by');
  eq(h[1].changes.amount, { from: 1000, to: 1200 }, 'amount diff');
  eq(h[1].changes.note, { from: null, to: 'revised' }, 'note diff');
  await db.query("update public.expenses set amount = 1000, note = null where id = $1", [e.id]);
});

console.log('\nMonth close, payments, reopen');
await check('backdated expenses before anyone joined split among founding members', async () => {
  await as(priya);
  await insertExpense('500.00', 'Last month gas', priya.id, prevDate);
  const s = await rpc('get_month_summary', hid, prevY, prevM);
  eq(s.is_past, true, 'is_past');
  eq(s.participant_count, 2, 'participants');
  eq(s.transfers, [{ from: arun.id, to: priya.id, amount_paise: 25000 }], 'transfers');
});
await check('clients cannot call internal settlement functions', async () => {
  await as(arun);
  await expectError(() => rpc('compute_settlement', hid, ty, tm), /permission denied/);
  await expectError(() => rpc('close_month_internal', hid, prevY, prevM, arun.id), /permission denied/);
});
await check('only the owner closes, and only months that have ended', async () => {
  await as(priya);
  await expectError(() => rpc('close_month', hid, prevY, prevM), /Only the Owner/);
  await as(arun);
  await expectError(() => rpc('close_month', hid, ty, tm), /once it has ended/);
  eq((await rpc('get_month_summary', hid, prevY, prevM)).status, 'open', 'not closed automatically');
  await rpc('close_month', hid, prevY, prevM);
  await expectError(() => rpc('close_month', hid, prevY, prevM), /already closed/);
  const c = await one('select status, closed_by from public.month_closures where household_id = $1 and year = $2 and month = $3', [hid, prevY, prevM]);
  eq(c, { status: 'closed', closed_by: arun.id }, 'closure');
});
await check('closed month locks its expenses', async () => {
  await as(priya);
  await expectError(() => db.query("update public.expenses set amount = 600 where description = 'Last month gas'"), /closed/);
  await expectError(() => db.query("delete from public.expenses where description = 'Last month gas'"), /closed/);
  await expectError(() => insertExpense('10', 'Late entry', priya.id, prevDate), /closed/);
  await expectError(() => db.query("update public.expenses set expense_date = $1 where description = 'Vegetables'", [prevDate]), /closed/);
});
await check('closed month shows final settlement with payment rows', async () => {
  await as(vik);
  const s = await rpc('get_month_summary', hid, prevY, prevM);
  eq(s.status, 'closed', 'status');
  eq(s.payments.length, 1, 'payments');
  eq([s.payments[0].from, s.payments[0].to, s.payments[0].amount_paise, s.payments[0].paid_on], [arun.id, priya.id, 25000, null], 'payment');
});
await check('mark paid: payer/receiver/owner only, sensible date', async () => {
  await as(vik);
  const pid = (await rpc('get_month_summary', hid, prevY, prevM)).payments[0].id;
  await expectError(() => rpc('mark_payment', pid, today), /payer, the receiver or the Owner/);
  await as(priya);
  await expectError(() => rpc('mark_payment', pid, tomorrow), /between/);
  await rpc('mark_payment', pid, today);
  const s = await rpc('get_month_summary', hid, prevY, prevM);
  eq([s.payments[0].paid_on, s.payments[0].marked_by], [today, priya.id], 'marked');
  await rpc('mark_payment', pid, null);
  eq((await rpc('get_month_summary', hid, prevY, prevM)).payments[0].paid_on, null, 'unmarked');
});
await check('reopen keeps Paid marks; re-close carries them to the new figures', async () => {
  await as(priya);
  const pid = (await rpc('get_month_summary', hid, prevY, prevM)).payments[0].id;
  await rpc('mark_payment', pid, today);
  await expectError(() => rpc('reopen_month', hid, prevY, prevM), /Only the Owner/);
  await as(arun);
  await rpc('reopen_month', hid, prevY, prevM);
  let s = await rpc('get_month_summary', hid, prevY, prevM);
  eq(s.status, 'reopened', 'reopened');
  eq([s.payments.length, s.payments[0].paid_on, s.payments[0].paid_amount_paise], [1, today, 25000], 'mark kept while reopened');
  await as(priya);
  await db.query("update public.expenses set amount = 600 where description = 'Last month gas'");
  await as(arun);
  await rpc('close_month', hid, prevY, prevM);
  s = await rpc('get_month_summary', hid, prevY, prevM);
  eq([s.status, s.total_paise], ['closed', 60000], 'recalculated');
  eq(s.payments.map((p) => [p.from, p.to, p.amount_paise, p.paid_amount_paise, p.paid_on]),
    [[arun.id, priya.id, 30000, 25000, today]], 'mark carried over with what was paid');
  await rpc('mark_payment', s.payments[0].id, today);
  eq((await rpc('get_month_summary', hid, prevY, prevM)).payments[0].paid_amount_paise, 30000, 'topped up to full');
});
await check('a paid payment that is no longer owed stays visible with amount 0', async () => {
  await as(arun);
  await rpc('reopen_month', hid, prevY, prevM);
  await as(priya);
  await db.query("update public.expenses set paid_by = $1 where description = 'Last month gas'", [arun.id]);
  await as(arun);
  await rpc('close_month', hid, prevY, prevM);
  const s = await rpc('get_month_summary', hid, prevY, prevM);
  eq(s.payments.map((p) => [p.from, p.to, p.amount_paise, p.paid_amount_paise]).sort(),
    [[arun.id, priya.id, 0, 30000], [priya.id, arun.id, 30000, null]].sort(), 'old paid row kept, new direction added');
  const zero = s.payments.find((p) => p.amount_paise === 0);
  await expectError(() => rpc('mark_payment', zero.id, today), /Nothing is owed/);
  await rpc('reopen_month', hid, prevY, prevM);
  await as(priya);
  await db.query("update public.expenses set paid_by = $1 where description = 'Last month gas'", [priya.id]);
  await as(arun);
  await rpc('close_month', hid, prevY, prevM);
  eq((await rpc('get_month_summary', hid, prevY, prevM)).payments.map((p) => [p.amount_paise, p.paid_amount_paise]),
    [[30000, 30000]], 'back to one fully paid row');
});

console.log('\nRoles & categories');
await check('owner-only category management', async () => {
  await as(priya);
  await expectError(() => db.query('insert into public.categories (household_id, name) values ($1, $2)', [hid, 'Pets']), /row-level security|permission to add/);
  await as(arun);
  await db.query('insert into public.categories (household_id, name, sort_order) values ($1, $2, 10)', [hid, 'Pets']);
  await db.query("update public.categories set name = 'Groceries & Fruit' where id = $1", [catId]);
  await expectError(() => db.query('insert into public.categories (household_id, name) values ($1, $2)', [hid, 'pets']), /duplicate key/);
});
await check('owner changes roles; viewer promoted joins the split', async () => {
  await as(arun);
  const vm = await one('select id from public.household_members where user_id = $1 and removed_at is null', [vik.id]);
  await rpc('change_member_role', vm.id, 'member');
  eq((await rpc('get_month_summary', hid, ty, tm)).participant_count, 3, 'three participants');
  await rpc('change_member_role', vm.id, 'viewer');
  const om = await one("select id from public.household_members where role = 'owner'");
  await expectError(() => rpc('change_member_role', om.id, 'viewer'), /Owner's role/);
  await expectError(() => rpc('remove_member', om.id), /cannot be removed/);
});
await check('owner sees pending invite links', async () => {
  await as(arun);
  const t = await rpc('create_invite', hid, 'viewer', 'Mum');
  const rows = (await db.query("select token, label from public.household_invites where status = 'pending' and expires_at > now()")).rows;
  eq(rows, [{ token: t, label: 'Mum' }], 'pending visible to owner');
});
await check('removed member loses access but stays in this month\'s split', async () => {
  await as(arun);
  const pm = await one('select id from public.household_members where user_id = $1 and removed_at is null', [priya.id]);
  await rpc('remove_member', pm.id);
  eq((await rpc('get_month_summary', hid, ty, tm)).participant_count, 2, 'still a participant this month');
  await as(priya);
  eq((await one('select count(*)::int as n from public.expenses')).n, 0, 'no access');
  await expectError(() => insertExpense('10', 'After removal', priya.id), /row-level security|permission to add/);
});

await check('later joiners are never added to earlier months', async () => {
  // Make Arun/Priya/Vik founding members three months ago, then a newcomer joins today.
  const back = (n) => { const d = new Date(Date.UTC(ty, tm - 1 - n, 1)); return d.toISOString().slice(0, 10); };
  await service();
  await db.query("update public.household_members set joined_at = $1::date where user_id = any($2)", [back(3), [arun.id, priya.id, vik.id]]);
  const late = { id: '55555555-5555-5555-5555-555555555555', email: 'late@example.com', name: 'Late' };
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [late.id, late.email, { display_name: 'Late' }]);
  await as(arun);
  const t = await rpc('create_invite', hid, 'member', 'Late');
  await as(late);
  await rpc('accept_invite', t);
  await as(arun);
  await insertExpense('900.00', 'Very old bill', arun.id, back(5));
  const [y5, m5] = back(5).split('-').map(Number);
  const s5 = await rpc('get_month_summary', hid, y5, m5);
  eq(s5.participant_count, 2, 'founding owner/members only (Vik is a viewer)');
  assert(!s5.people.some((p) => p.user_id === late.id), 'newcomer not in backdated month');
  const [y3, m3] = back(3).split('-').map(Number);
  assert(!(await rpc('get_month_summary', hid, y3, m3)).people.some((p) => p.user_id === late.id), 'newcomer not in month 3');
  assert((await rpc('get_month_summary', hid, ty, tm)).people.some((p) => p.user_id === late.id), 'newcomer in current month');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

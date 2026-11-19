// DEV/TEST ONLY — a tiny stand-in for Supabase (auth + PostgREST subset) backed by PGlite,
// running the real migrations with RLS enforced. Lets you click through the app offline.
// Tokens are unsigned and every account uses the seed password below: never expose this server.
// Usage: node tests/fake-supabase.mjs   (listens on 127.0.0.1:54329)
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const PORT = Number(process.env.FAKE_SUPABASE_PORT || 54329);
const SEED_PASSWORD = 'local-demo-only';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Keep DATE columns as 'YYYY-MM-DD' text, like PostgREST.
const db = new PGlite({ parsers: { 1082: (v) => v } });
const passwords = new Map(); // email -> password (in memory)

// PGlite has one connection: run each request's statements back to back.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

// ---------- bootstrap ----------
await db.exec(readFileSync(join(root, 'tests/supabase_stub.sql'), 'utf8'));
for (const f of readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
}
const setOf = new Set((await db.query("select proname from pg_proc where pronamespace = 'public'::regnamespace and proretset")).rows.map((r) => r.proname));
const voidFns = new Set((await db.query("select proname from pg_proc where pronamespace = 'public'::regnamespace and prorettype = 'void'::regtype")).rows.map((r) => r.proname));

async function createUser(email, name) {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, { display_name: name }]);
  return { id, email };
}
async function asUser(u, fn) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.email', $2, false)", [u?.id ?? '', u?.email ?? '']);
  await db.exec(u ? 'set role authenticated' : 'reset role');
  try { return await fn(); } finally { await db.exec('reset role'); }
}

async function seed() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const [y, m] = today.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const day = (d) => (`${today.slice(0, 8)}${String(d).padStart(2, '0')}` <= today ? `${today.slice(0, 8)}${String(d).padStart(2, '0')}` : today);

  const arun = await createUser('arun@example.com', 'Arun');
  const priya = await createUser('priya@example.com', 'Priya');
  const vik = await createUser('vik@example.com', 'Vik');
  await createUser('newbie@example.com', 'Newbie');
  for (const e of ['arun@example.com', 'priya@example.com', 'vik@example.com', 'newbie@example.com']) passwords.set(e, SEED_PASSWORD);

  const hid = await asUser(arun, async () => (await db.query("select public.create_household('Flat 4B') as id")).rows[0].id);
  for (const [u, role] of [[priya, 'member'], [vik, 'viewer']]) {
    const token = await asUser(arun, async () => (await db.query('select public.create_invite($1, $2, $3) as t', [hid, role, u.email])).rows[0].t);
    await asUser(u, () => db.query('select public.accept_invite($1)', [token]));
  }
  // Founding members joined two months ago, so later joiners stay out of earlier months.
  await db.query("update public.household_members set joined_at = now() - interval '60 days'");
  await db.query("update public.households set created_at = now() - interval '60 days'");
  newbieToken = await asUser(arun, async () => (await db.query("select public.create_invite($1, 'member', 'Newbie') as t", [hid])).rows[0].t);
  const cats = Object.fromEntries((await db.query('select name, id from public.categories')).rows.map((r) => [r.name, r.id]));
  const add = (u, amount, desc, cat, date, paidBy = u.id, note = null) => asUser(u, () => db.query(
    'insert into public.expenses (household_id, amount, description, category_id, expense_date, paid_by, note) values ($1,$2,$3,$4,$5,$6,$7)',
    [hid, amount, desc, cats[cat], date, paidBy, note]));

  await add(arun, 18000, 'November rent', 'Rent', day(1));
  await add(priya, 2450.5, 'Big basket order', 'Groceries', day(3));
  await add(priya, 1199, 'Broadband bill', 'Internet & Mobile', day(5), arun.id, 'Logged for Arun — he paid from his card');
  await add(arun, 860, 'Electricity', 'Utilities', day(8));
  await add(priya, 640, 'Dinner takeaway', 'Dining & Takeaway', day(10));
  await add(priya, 310, 'Cleaning supplies', 'Household Supplies', today);
  await add(arun, 17000, 'Rent', 'Rent', `${prev}-01`);
  await add(priya, 5200, 'Monthly groceries', 'Groceries', `${prev}-12`);
  await add(priya, 1500, 'Plumber', 'Maintenance & Repairs', `${prev}-20`);
  await asUser(priya, () => db.query("update public.expenses set amount = 2450.50, note = 'Includes fruit' where description = 'Big basket order'"));
  await asUser(arun, () => db.query('select public.close_month($1, $2, $3)', [hid, Number(prev.slice(0, 4)), Number(prev.slice(5))]));
}
let newbieToken;
await seed();

// ---------- auth helpers ----------
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sessionFor(user) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: now + 86400, iat: now };
  return {
    access_token: `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.fake`,
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: now + 86400,
    refresh_token: `refresh-${user.id}`,
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}
function userFromAuth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return c.sub && c.email ? { id: c.sub, email: c.email } : null;
  } catch { return null; }
}
async function findUser(email) {
  return (await db.query('select id, email from auth.users where email = $1', [email])).rows[0];
}

// ---------- PostgREST subset ----------
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s) => { if (!IDENT.test(s)) throw httpError(400, `bad identifier ${s}`); return `"${s}"`; };
function httpError(status, message, code = 'PGRST000') { return Object.assign(new Error(message), { status, code }); }

function splitTop(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

async function fkColumn(from, to) {
  const r = await db.query(
    `select a.attname from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.conrelid = $1::regclass and c.confrelid = $2::regclass`, [`public.${from}`, `public.${to}`]);
  if (!r.rows[0]) throw httpError(400, `no relationship ${from} -> ${to}`);
  return r.rows[0].attname;
}

async function selectList(table, select) {
  const parts = [];
  for (const item of splitTop(select || '*')) {
    if (item === '*') { parts.push('t.*'); continue; }
    const embed = item.match(/^(?:([a-z_]+):)?([a-z_]+)\((.*)\)$/);
    if (embed) {
      const [, alias, target, cols] = embed;
      const fk = await fkColumn(table, target);
      const inner = cols === '*' ? '*' : splitTop(cols).map(ident).join(', ');
      parts.push(`(select row_to_json(e) from (select ${inner} from public.${ident(target)} where id = t.${ident(fk)}) e) as ${ident(alias || target)}`);
    } else parts.push(`t.${ident(item)}`);
  }
  return parts.join(', ');
}

function whereClause(params, values) {
  const conds = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'columns', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    const m = v.match(/^(eq|neq|gt|gte|lt|lte|is)\.(.*)$/);
    if (!m) throw httpError(400, `unsupported filter ${k}=${v}`);
    const [, op, raw] = m;
    if (op === 'is') {
      if (!['null', 'true', 'false'].includes(raw)) throw httpError(400, 'bad is filter');
      conds.push(`t.${ident(k)} is ${raw}`);
    } else {
      values.push(raw);
      conds.push(`t.${ident(k)} ${{ eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} $${values.length}`);
    }
  }
  return conds.length ? ` where ${conds.join(' and ')}` : '';
}

function orderClause(order) {
  if (!order) return '';
  return ' order by ' + order.split(',').map((o) => {
    const [col, dir = 'asc'] = o.split('.');
    return `t.${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}`;
  }).join(', ');
}

async function rest(req, user, url, body) {
  const path = url.pathname.replace(/^\/rest\/v1\//, '');
  const wantsObject = (req.headers.accept || '').includes('vnd.pgrst.object');
  const returnRep = (req.headers.prefer || '').includes('return=representation');

  if (path.startsWith('rpc/')) {
    const fn = path.slice(4);
    ident(fn);
    const args = Object.entries(body || {});
    // Arrays go as Postgres arrays (e.g. uuid[]); other objects as JSON.
    const values = args.map(([, v]) => (Array.isArray(v) ? v : v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
    const call = `public.${ident(fn)}(${args.map(([k], i) => `${ident(k)} => $${i + 1}`).join(', ')})`;
    if (setOf.has(fn)) return { status: 200, json: (await asUser(user, () => db.query(`select * from ${call}`, values))).rows };
    const r = (await asUser(user, () => db.query(`select ${call} as r`, values))).rows[0].r;
    return voidFns.has(fn) ? { status: 204 } : { status: 200, json: r };
  }

  const table = path;
  ident(table);
  const values = [];
  let sql;
  if (req.method === 'GET') {
    sql = `select ${await selectList(table, url.searchParams.get('select'))} from public.${ident(table)} t${whereClause(url.searchParams, values)}${orderClause(url.searchParams.get('order'))}`;
  } else if (req.method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const cols = Object.keys(rows[0]);
    const tuples = rows.map((r) => `(${cols.map((c) => { values.push(r[c]); return `$${values.length}`; }).join(', ')})`);
    sql = `insert into public.${ident(table)} as t (${cols.map(ident).join(', ')}) values ${tuples.join(', ')} returning *`;
  } else if (req.method === 'PATCH') {
    const sets = Object.entries(body).map(([c, v]) => { values.push(v); return `${ident(c)} = $${values.length}`; });
    sql = `update public.${ident(table)} t set ${sets.join(', ')}${whereClause(url.searchParams, values)} returning *`;
  } else if (req.method === 'DELETE') {
    sql = `delete from public.${ident(table)} t${whereClause(url.searchParams, values)} returning *`;
  } else throw httpError(405, 'method not allowed');

  const rows = (await asUser(user, () => db.query(sql, values))).rows;
  if (req.method !== 'GET' && !returnRep) return { status: 204 };
  if (wantsObject) {
    if (rows.length !== 1) throw httpError(406, 'JSON object requested, multiple (or no) rows returned', 'PGRST116');
    return { status: 200, json: rows[0] };
  }
  return { status: 200, json: rows };
}

async function auth(req, url, body) {
  const p = url.pathname.replace(/^\/auth\/v1\//, '');
  if (p === 'token' && url.searchParams.get('grant_type') === 'password') {
    const email = String(body.email || '').toLowerCase();
    const u = await findUser(email);
    if (!u || passwords.get(email) !== body.password) return { status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' } };
    return { status: 200, json: sessionFor(u) };
  }
  if (p === 'token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const id = String(body.refresh_token || '').replace(/^refresh-/, '');
    const u = (await db.query('select id, email from auth.users where id::text = $1', [id])).rows[0];
    return u ? { status: 200, json: sessionFor(u) } : { status: 400, json: { msg: 'Invalid refresh token' } };
  }
  if (p === 'signup') {
    const email = String(body.email || '').toLowerCase();
    if (await findUser(email)) return { status: 422, json: { msg: 'User already registered', code: 'user_already_exists' } };
    const u = await createUser(email, body.data?.display_name || email.split('@')[0]);
    passwords.set(email, body.password);
    return { status: 200, json: sessionFor(u) };
  }
  if (p === 'user') {
    const u = userFromAuth(req);
    return u ? { status: 200, json: sessionFor(u).user } : { status: 401, json: { msg: 'not signed in' } };
  }
  if (p === 'logout') return { status: 204 };
  if (p === 'otp') return { status: 200, json: {} };
  return { status: 404, json: { msg: `auth endpoint ${p} not faked` } };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => serial(async () => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let out;
    try {
      const body = raw ? JSON.parse(raw) : undefined;
      if (url.pathname.startsWith('/auth/v1/')) out = await auth(req, url, body);
      else if (url.pathname.startsWith('/rest/v1/')) out = await rest(req, userFromAuth(req), url, body);
      else out = { status: 404, json: { message: 'not found' } };
    } catch (e) {
      const status = e.status || (e.code === '42501' ? 403 : 400);
      out = { status, json: { code: e.code ?? null, message: e.message, details: e.detail ?? null, hint: e.hint ?? null } };
    }
    console.log(`${req.method} ${url.pathname}${url.search} -> ${out.status}`);
    res.writeHead(out.status, { ...CORS, 'content-type': 'application/json' });
    res.end(out.status === 204 ? undefined : JSON.stringify(out.json ?? null));
  }));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Fake Supabase on http://127.0.0.1:${PORT} (seed password: see SEED_PASSWORD in this file)`);
  console.log(`Invite link for newbie@example.com: http://localhost:5174/join/${newbieToken}`);
});

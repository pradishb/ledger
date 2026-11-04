// Convert a HomeBank .xhb file into one SQL script for the Supabase SQL Editor.
//
//   node scripts/import-homebank.mjs [--replace] <file.xhb> <out.sql>
//
// The SQL runs as a single transaction and imports into the only user in auth.users.
// It refuses to run if that user already has data, unless --replace is given: then it
// deletes the user's existing ledger first, in the same transaction, so a failed
// import leaves the old data untouched.
//
// Currencies: each account gets its HomeBank currency and keeps its own amounts; transfers
// between currencies keep both sides. HomeBank's exchange rates are not imported: the app
// uses today's rates.
import fs from 'node:fs';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const [inFile, outFile] = args.filter(a => a !== '--replace');
if (!inFile || !outFile) {
  console.error('Usage: node scripts/import-homebank.mjs [--replace] <file.xhb> <out.sql>');
  process.exit(1);
}

// --- Parse: HomeBank writes one self-closing element per record. ---
const decode = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
const xml = fs.readFileSync(inFile, 'utf8');
const els = [...xml.matchAll(/<(\w+)((?:\s+[\w:]+="[^"]*")*)\s*\/?>/g)].map(m => {
  const a = {};
  for (const [, k, v] of m[2].matchAll(/([\w:]+)="([^"]*)"/g)) a[k] = decode(v);
  return { tag: m[1], a };
});
const all = tag => els.filter(e => e.tag === tag).map(e => e.a);
const groups = new Map(all('grp').map(g => [g.key, g.name]));
const hbAccounts = all('account');
const hbCats = all('cat');
const hbPayees = all('pay');
const hbOps = all('ope');

// --- Currencies: an account without its own currency is in HomeBank's base currency. ---
const hbCurs = new Map(all('cur').map(c => [c.key, c]));
const baseKey = all('properties')[0]?.curr;
const curOf = a => {
  const iso = hbCurs.get(a.curr || baseKey)?.iso;
  if (!/^[A-Z]{3}$/.test(iso ?? '')) throw new Error(`No currency found for account "${a.name}"`);
  return iso;
};

// HomeBank dates are day numbers where 1 = 0001-01-01.
const toDate = n => {
  const d = new Date(0);
  d.setUTCFullYear(1, 0, 1);
  d.setUTCDate(+n);
  return d.toISOString().slice(0, 10);
};
const cents = s => Math.round(parseFloat(s) * 100);

// HomeBank 5 payment modes -> the app's PAYMENTS list (5 = internal transfer, which the app has no name for).
const PAYMODE = {
  1: 'Credit card', 2: 'Check', 3: 'Cash', 4: 'Bank transfer', 6: 'Debit card', 7: 'Standing order',
  8: 'Electronic payment', 9: 'Deposit', 10: 'FI fee', 11: 'Direct debit',
};
const payment = o => PAYMODE[o.paymode] ?? 'None';

// --- Accounts ---
// HomeBank account types: 1 bank, 2 cash, 3 asset, 4 credit card, 5 liability, 6 checking, 7 savings.
const HB_TYPE = { 1: 'bank', 2: 'cash', 3: 'asset', 4: 'credit', 5: 'liability', 6: 'bank', 7: 'bank' };
const accountType = a => {
  if (HB_TYPE[a.type]) return HB_TYPE[a.type];
  if (/^cash$/i.test(a.name)) return 'cash';
  return groups.get(a.grp) === 'Liquid' ? 'bank' : 'asset';
};
// Open accounts first, then closed ones; HomeBank's own order within each.
const accounts = hbAccounts
  .sort((x, y) => (x.flags & 2) - (y.flags & 2) || +x.pos - +y.pos)
  .map((a, i) => ({
    k: +a.key, name: a.name.trim(), type: accountType(a),
    inst: [groups.get(a.grp), a.flags & 2 ? 'Closed' : ''].filter(Boolean).join(' · '),
    open: cents(a.initial), sort: i, cur: curOf(a),
  }));

// --- Categories: HomeBank flag 2 = income; only two levels exist. ---
const PALETTE = [
  'oklch(0.56 0.09 155)', 'oklch(0.72 0.13 80)', 'oklch(0.6 0.11 245)', 'oklch(0.64 0.14 30)',
  'oklch(0.58 0.13 305)', 'oklch(0.65 0.1 195)', 'oklch(0.7 0.12 120)', 'oklch(0.62 0.12 355)',
];
let colorIdx = 0;
const cats = hbCats.map(c => ({
  k: +c.key, name: c.name.trim(), parent: c.parent ? +c.parent : null,
  type: c.flags & 2 ? 'inc' : 'exp',
  color: c.parent ? null : PALETTE[colorIdx++ % PALETTE.length],
}));
if (cats.some(c => c.parent && cats.find(p => p.k === c.parent)?.parent)) throw new Error('Categories deeper than two levels');

const payees = hbPayees.map(p => ({ name: p.name.trim() }));

// --- Transactions: HomeBank stores each transfer as two linked rows (kxfer); the app stores one. ---
const txns = [];
const pairs = new Map();
const notes = { xferCatDropped: 0, xferDateDiffers: 0, crossCurrency: 0, selfXferSkipped: 0 };
for (const [i, o] of hbOps.entries()) {
  if (o.dst_account) {
    (pairs.get(o.kxfer) ?? pairs.set(o.kxfer, []).get(o.kxfer)).push({ ...o, i });
    continue;
  }
  txns.push({ i, d: toDate(o.date), a: +o.account, x: null, amt: cents(o.amount), xamt: null, p: payment(o), c: o.category ? +o.category : null, m: o.wording ?? '' });
}
for (const [k, sides] of pairs) {
  if (sides.length !== 2) throw new Error(`Transfer ${k} has ${sides.length} sides`);
  // The paying (negative) side becomes the row; amount is from its point of view.
  const [from, to] = cents(sides[0].amount) <= 0 ? sides : [sides[1], sides[0]];
  // A transfer into the same account changes nothing, and the schema forbids it.
  if (from.account === from.dst_account) { notes.selfXferSkipped++; continue; }
  if (from.category || to.category) notes.xferCatDropped++;
  if (from.date !== to.date) notes.xferDateDiffers++;
  // Keep the receiving side's own amount whenever it differs (always, between currencies).
  const xamt = cents(to.amount) !== -cents(from.amount) ? cents(to.amount) : null;
  if (xamt !== null) notes.crossCurrency++;
  txns.push({
    i: Math.min(from.i, to.i), d: toDate(from.date), a: +from.account, x: +from.dst_account, amt: cents(from.amount), xamt,
    p: from.paymode ? payment(from) : payment(to), c: null, m: from.wording || to.wording || '',
  });
}
txns.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : x.i - y.i));

// --- Emit SQL ---
const data = {
  accounts,
  cats,
  payees,
  txns: txns.map(t => [t.d, t.a, t.x, t.amt, t.p, t.c, t.m, t.xamt]),
};
const json = JSON.stringify(data);
if (json.includes('$json$')) throw new Error('Data contains the SQL quote delimiter');

const sqlBody = `do $import$
declare
  d jsonb := $json$${json}$json$::jsonb;
  uid uuid;
  n int;
  r record;
  new_id bigint;
begin
  select count(*) into n from auth.users;
  if n <> 1 then raise exception 'Expected exactly one user in auth.users, found %', n; end if;
  select id into uid from auth.users;

  ${replace ? `-- --replace: clear this user's ledger first (rolled back if the import fails).
  delete from public.transactions where user_id = uid;
  delete from public.payees where user_id = uid;
  update public.categories set parent_id = null where user_id = uid;
  delete from public.categories where user_id = uid;
  delete from public.accounts where user_id = uid;

  ` : ''}if exists (select 1 from public.accounts where user_id = uid)
     or exists (select 1 from public.categories where user_id = uid)
     or exists (select 1 from public.payees where user_id = uid)
     or exists (select 1 from public.transactions where user_id = uid) then
    raise exception 'This ledger already has data. Delete its accounts, categories, payees and transactions first.';
  end if;

  create temp table hb_acc (k int primary key, id bigint not null) on commit drop;
  create temp table hb_cat (k int primary key, id bigint not null) on commit drop;

  for r in select * from jsonb_to_recordset(d->'accounts') as x(k int, name text, type text, inst text, open bigint, sort int, cur text) loop
    insert into public.accounts (user_id, name, type, institution, opening_cents, sort, currency)
    values (uid, r.name, r.type, r.inst, r.open, r.sort, r.cur) returning id into new_id;
    insert into hb_acc values (r.k, new_id);
  end loop;

  -- Parents first, then subcategories.
  for r in select * from jsonb_to_recordset(d->'cats') as x(k int, name text, parent int, type text, color text)
           order by (x.parent is not null), x.k loop
    insert into public.categories (user_id, name, parent_id, type, color)
    values (uid, r.name, (select id from hb_cat where k = r.parent), r.type, r.color) returning id into new_id;
    insert into hb_cat values (r.k, new_id);
  end loop;

  insert into public.payees (user_id, name)
  select uid, x.name from jsonb_to_recordset(d->'payees') as x(name text);

  insert into public.transactions (user_id, date, account_id, transfer_account_id, amount_cents, payment, category_id, memo, transfer_amount_cents)
  select uid, (t.v->>0)::date, a.id, xa.id, (t.v->>3)::bigint, t.v->>4, c.id, t.v->>6, (t.v->>7)::bigint
  from jsonb_array_elements(d->'txns') with ordinality as t(v, ord)
  join hb_acc a on a.k = (t.v->>1)::int
  left join hb_acc xa on xa.k = (t.v->>2)::int
  left join hb_cat c on c.k = (t.v->>5)::int
  order by t.ord;

  get diagnostics n = row_count;
  if n <> jsonb_array_length(d->'txns') then
    raise exception 'Imported % of % transactions', n, jsonb_array_length(d->'txns');
  end if;
  raise notice 'Imported % accounts, % categories, % payees, % transactions',
    jsonb_array_length(d->'accounts'), jsonb_array_length(d->'cats'), jsonb_array_length(d->'payees'), n;
end
$import$;
`;
const header = `-- HomeBank import generated from ${inFile.replace(/.*[\\/]/, '')} on ${new Date().toISOString().slice(0, 10)}
-- ${accounts.length} accounts, ${cats.length} categories, ${payees.length} payees, ${txns.length} transactions.
-- Run once in the Supabase SQL Editor. Everything rolls back if any statement fails.
`;
fs.writeFileSync(outFile, header + sqlBody);

// Sanity check: balances computed from the app's model must match HomeBank's own rows.
const hbBal = new Map();
for (const o of hbOps) hbBal.set(+o.account, (hbBal.get(+o.account) ?? 0) + cents(o.amount));
const appBal = new Map();
for (const t of txns) {
  appBal.set(t.a, (appBal.get(t.a) ?? 0) + t.amt);
  if (t.x) appBal.set(t.x, (appBal.get(t.x) ?? 0) + (t.xamt ?? -t.amt));
}
const mismatched = accounts.filter(a => (hbBal.get(a.k) ?? 0) !== (appBal.get(a.k) ?? 0));

console.log(`Wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
console.log(`${accounts.length} accounts, ${cats.length} categories, ${payees.length} payees, ${txns.length} transactions (${pairs.size} transfers)`);
console.log('Transfers with a category (category dropped):', notes.xferCatDropped);
console.log('Transfers whose two sides had different dates (paying side used):', notes.xferDateDiffers);
console.log('Transfers with a different amount received (both kept):', notes.crossCurrency);
const byCur = new Map();
for (const a of accounts) byCur.set(a.cur, (byCur.get(a.cur) ?? 0) + 1);
console.log('Accounts by currency:', [...byCur].map(([c, n]) => `${c} ${n}`).join(', '));
console.log('Transfers into the same account (skipped, no balance effect):', notes.selfXferSkipped);
for (const a of mismatched) console.log(`Balance differs from HomeBank: ${a.name} ${(hbBal.get(a.k) ?? 0) / 100} -> ${(appBal.get(a.k) ?? 0) / 100}`);

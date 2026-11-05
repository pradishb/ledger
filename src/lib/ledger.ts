// Pure calculations over the full data set. Everything is in cents: an account's own currency
// for balances and register rows, the display currency for totals and reports.
import type { Rates } from '../data/rates';
import { ACCOUNT_TYPES, OTHER } from './types';
import type { Account, CatType, Category, LedgerData, Payee, Txn } from './types';

/** `disp` is the display currency; `rates` may be missing before the first fetch. */
export function buildIndex(d: LedgerData, disp: string, rates: Rates | undefined) {
  const catMap = new Map<number, Category>(d.cats.map(c => [c.id, c]));
  const payMap = new Map<number, Payee>(d.payees.map(p => [p.id, p]));
  const accMap = new Map<number, Account>(d.accounts.map(a => [a.id, a]));
  /** ISO code of an account's currency. */
  const accCur = (id: number) => accMap.get(id)?.currency ?? disp;
  /** Convert between currencies at today's rate; null when a rate is missing. */
  const convert = (cents: number, from: string, to: string) => {
    if (from === to) return cents;
    const f = rates?.perUsd[from], t = rates?.perUsd[to];
    return f && t ? Math.round((cents / f) * t) : null;
  };
  /** An amount in an account's currency, in the display currency (0 without a rate). */
  const toDisp = (accId: number, cents: number) => convert(cents, accCur(accId), disp) ?? 0;
  /** Account currencies that can't be converted, so are left out of totals. */
  const unrated = [...new Set(d.accounts.map(a => a.currency))].filter(c => convert(1, c, disp) === null);
  const tops = d.cats.filter(c => !c.parent);
  const subsOf = (id: number) => d.cats.filter(c => c.parent === id);
  const topOf = (id: number): Category | null => {
    const c = catMap.get(id);
    if (!c) return null;
    return c.parent ? catMap.get(c.parent) ?? null : c;
  };
  const catType = (id: number): CatType => topOf(id)?.type ?? 'exp';
  const catColor = (id: number) => topOf(id)?.color ?? OTHER;
  const catLabel = (id: number) => {
    const c = catMap.get(id);
    if (!c) return '';
    return c.parent ? `${catMap.get(c.parent)?.name ?? '?'} › ${c.name}` : c.name;
  };
  return { catMap, payMap, accMap, tops, subsOf, topOf, catType, catColor, catLabel, disp, rates, accCur, convert, toDisp, unrated };
}
export type Index = ReturnType<typeof buildIndex>;

/** What a transaction does to account `acc`, in that account's currency. */
export const amountFor = (t: Txn, acc: number) => (t.acc === acc ? t.amount : t.xamt ?? -t.amount);

/** Balance per account as of today, in its own currency; future-dated transactions are left out. */
export function balances(d: LedgerData, today: string) {
  const bal = new Map<number, number>();
  for (const a of d.accounts) bal.set(a.id, a.opening);
  const apply = (id: number, amt: number) => {
    if (bal.has(id)) bal.set(id, bal.get(id)! + amt);
  };
  for (const t of d.txns) {
    if (t.date > today) continue;
    apply(t.acc, t.amount);
    if (t.xfer) apply(t.xfer, t.xamt ?? -t.amount);
  }
  return bal;
}

export interface Flow {
  /** The transaction it comes from (a split transaction gives several flows with the same id). */
  id: number;
  cat: number;
  amount: number;
  payee: number;
  date: string;
}

/** Income/expense entries between two dates in the display currency, transfers excluded, splits expanded. */
export function flows(txns: Txn[], from: string, to: string, idx: Index): Flow[] {
  const out: Flow[] = [];
  for (const t of txns) {
    if (t.xfer || t.date < from || t.date > to) continue;
    if (t.splits) for (const s of t.splits) out.push({ id: t.id, cat: s.cat, amount: idx.toDisp(t.acc, s.amount), payee: t.payee, date: t.date });
    else out.push({ id: t.id, cat: t.cat, amount: idx.toDisp(t.acc, t.amount), payee: t.payee, date: t.date });
  }
  return out;
}

/** Total of one type as a positive number (spending is reported as positive). */
export const sumType = (fl: Flow[], type: CatType, idx: Index) =>
  fl.reduce((a, f) => (idx.catType(f.cat) === type ? a + (type === 'exp' ? -f.amount : f.amount) : a), 0);

export const sumBy = <T>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);

export interface AccountGroup {
  /** Unique across both ways of grouping, for remembering which groups are open. */
  key: string;
  label: string;
  accounts: Account[];
  /** Group total in the display currency. */
  balance: number;
}

export type GroupBy = 'type' | 'group';

/** Accounts grouped by type (in the fixed type order) or by their own group (A to Z, ungrouped last). */
export function accountGroups(accounts: Account[], bal: Map<number, number>, idx: Index, by: GroupBy = 'type'): AccountGroup[] {
  const make = (key: string, label: string, list: Account[]): AccountGroup =>
    ({ key, label, accounts: list, balance: sumBy(list, a => idx.toDisp(a.id, bal.get(a.id) ?? 0)) });
  if (by === 'type') {
    return ACCOUNT_TYPES.flatMap(([type, label]) => {
      const list = accounts.filter(a => a.type === type);
      // Type keys stay the bare label, so groups opened before this option existed stay open.
      return list.length ? [make(label, label, list)] : [];
    });
  }
  const names = [...new Set(accounts.map(a => a.group))]
    .sort((x, y) => (+!x - +!y) || x.localeCompare(y, undefined, { sensitivity: 'base', numeric: true }));
  return names.map(n => make(`group:${n}`, n || 'No group', accounts.filter(a => a.group === n)));
}

export const balColor = (n: number) => (n < 0 ? 'var(--neg)' : 'var(--ink)');

/** Display fields shared by every transaction list. `viewAcc` is the account being viewed, or 0. */
/** An income or expense with no category (not a transfer or a split), which still needs one. */
export const needsCategory = (t: Txn, idx: Index) => !t.xfer && !t.splits && !idx.catMap.has(t.cat);

export const NEEDS_CATEGORY = 'This needs a category';

export function describeTxn(t: Txn, amt: number, viewAcc: number, idx: Index) {
  const isX = !!t.xfer;
  let payee: string;
  if (isX) {
    const from = idx.accMap.get(t.acc)?.name ?? '?';
    const to = idx.accMap.get(t.xfer)?.name ?? '?';
    payee = viewAcc ? (amt < 0 ? `To ${viewAcc === t.acc ? to : from}` : `From ${viewAcc === t.acc ? to : from}`) : `${from} → ${to}`;
  } else payee = idx.payMap.get(t.payee)?.name || '—';
  const missing = needsCategory(t, idx);
  const category = isX ? 'Transfer' : t.splits ? `Split · ${t.splits.length} categories` : missing ? NEEDS_CATEGORY : idx.catLabel(t.cat);
  return {
    payee,
    category,
    catColor: missing ? 'var(--neg)' : isX || t.splits ? 'var(--ink3)' : 'var(--ink2)',
    amtColor: isX ? 'var(--ink2)' : amt > 0 ? 'var(--inc)' : 'var(--out)',
  };
}

export function sortTxnsAsc(a: Txn, b: Txn) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;
}

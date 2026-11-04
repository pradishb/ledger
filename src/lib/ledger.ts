// Pure calculations over the full data set. Everything is in cents.
import { ACCOUNT_TYPES, OTHER } from './types';
import type { Account, CatType, Category, LedgerData, Payee, Txn } from './types';

export function buildIndex(d: LedgerData) {
  const catMap = new Map<number, Category>(d.cats.map(c => [c.id, c]));
  const payMap = new Map<number, Payee>(d.payees.map(p => [p.id, p]));
  const accMap = new Map<number, Account>(d.accounts.map(a => [a.id, a]));
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
  return { catMap, payMap, accMap, tops, subsOf, topOf, catType, catColor, catLabel };
}
export type Index = ReturnType<typeof buildIndex>;

export interface Balance {
  today: number;
  future: number;
}

export function balances(d: LedgerData, today: string) {
  const bal = new Map<number, Balance>();
  for (const a of d.accounts) bal.set(a.id, { today: a.opening, future: a.opening });
  const apply = (id: number, amt: number, date: string) => {
    const b = bal.get(id);
    if (!b) return;
    b.future += amt;
    if (date <= today) b.today += amt;
  };
  for (const t of d.txns) {
    apply(t.acc, t.amount, t.date);
    if (t.xfer) apply(t.xfer, -t.amount, t.date);
  }
  return bal;
}

export interface Flow {
  cat: number;
  amount: number;
  payee: number;
  date: string;
}

/** Income/expense entries between two dates, transfers excluded, splits expanded. */
export function flows(txns: Txn[], from: string, to: string): Flow[] {
  const out: Flow[] = [];
  for (const t of txns) {
    if (t.xfer || t.date < from || t.date > to) continue;
    if (t.splits) for (const s of t.splits) out.push({ cat: s.cat, amount: s.amount, payee: t.payee, date: t.date });
    else out.push({ cat: t.cat, amount: t.amount, payee: t.payee, date: t.date });
  }
  return out;
}

/** Total of one type as a positive number (spending is reported as positive). */
export const sumType = (fl: Flow[], type: CatType, idx: Index) =>
  fl.reduce((a, f) => (idx.catType(f.cat) === type ? a + (type === 'exp' ? -f.amount : f.amount) : a), 0);

export const sumBy = <T>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);

export interface AccountGroup {
  label: string;
  accounts: Account[];
  today: number;
  future: number;
}

export function accountGroups(accounts: Account[], bal: Map<number, Balance>): AccountGroup[] {
  return ACCOUNT_TYPES.flatMap(([type, label]) => {
    const list = accounts.filter(a => a.type === type);
    if (!list.length) return [];
    return [{
      label,
      accounts: list,
      today: sumBy(list, a => bal.get(a.id)?.today ?? 0),
      future: sumBy(list, a => bal.get(a.id)?.future ?? 0),
    }];
  });
}

export const balColor = (n: number) => (n < 0 ? 'var(--neg)' : 'var(--ink)');

/** Display fields shared by every transaction list. `viewAcc` is the account being viewed, or 0. */
export function describeTxn(t: Txn, amt: number, viewAcc: number, idx: Index) {
  const isX = !!t.xfer;
  let payee: string;
  if (isX) {
    const from = idx.accMap.get(t.acc)?.name ?? '?';
    const to = idx.accMap.get(t.xfer)?.name ?? '?';
    payee = viewAcc ? (amt < 0 ? `To ${viewAcc === t.acc ? to : from}` : `From ${viewAcc === t.acc ? to : from}`) : `${from} → ${to}`;
  } else payee = idx.payMap.get(t.payee)?.name || '—';
  const category = isX ? 'Transfer' : t.splits ? `Split · ${t.splits.length} categories` : idx.catLabel(t.cat) || '—';
  return {
    payee,
    category,
    catColor: isX || t.splits ? 'var(--ink3)' : 'var(--ink2)',
    amtColor: isX ? 'var(--ink2)' : amt > 0 ? 'var(--pos)' : 'var(--ink)',
  };
}

export function sortTxnsAsc(a: Txn, b: Txn) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;
}

import { Link } from 'react-router';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { Dot, Header, Seg, useUrlChoice, useUrlText } from '../components/common';
import { txnsLink } from '../lib/links';
import { errorMessage } from '../lib/format';
import { OTHER, type CatType, type Category, type Payee } from '../lib/types';
import { CategoryModal, PayeeModal } from '../components/CatPayeeModals';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CategoriesPayees() {
  const { data, idx, online, toast, setNewShortcut } = useLedger();
  const [tab, setTab] = useUrlChoice('tab', ['cat', 'payee'] as const, 'cat');
  const [catType, setCatType] = useUrlChoice<CatType>('type', ['exp', 'inc'], 'exp');
  // Which New dialog is open.
  const [dialog, setDialog] = useState<{ kind: 'cat'; category?: Category } | { kind: 'payee'; payee?: Payee } | null>(null);
  const [payeeQ, setPayeeQ] = useUrlText('q');
  const [catQ, setCatQ] = useUrlText('cq');
  const [catSort, setCatSort] = useUrlChoice('csort', SORTS, 'name');
  const [payeeSort, setPayeeSort] = useUrlChoice('sort', SORTS, 'name');

  const delCat = useLedgerMutation(api.deleteCategory);
  const delPayee = useLedgerMutation(api.deletePayee);
  const applyMatch = useLedgerMutation(api.applyPayeeMatch);

  // N opens New category or New payee for the tab shown (but not over an open dialog).
  const state = useRef({ tab, dialog });
  useEffect(() => { state.current = { tab, dialog }; }, [tab, dialog]);
  useEffect(() => {
    setNewShortcut(() => { if (!state.current.dialog) setDialog({ kind: state.current.tab }); });
    return () => setNewShortcut(null);
  }, [setNewShortcut]);

  const run = <A,>(m: { mutateAsync: (a: A) => Promise<unknown> }, arg: A, ok?: string) =>
    m.mutateAsync(arg).then(() => ok && toast(ok), e => toast(errorMessage(e)));

  // How many transactions use each category and payee.
  const cnt = new Map<number, number>(), pcnt = new Map<number, number>();
  const inc = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const t of data.txns) {
    if (t.payee) inc(pcnt, t.payee);
    for (const e of t.splits ?? (t.cat ? [{ cat: t.cat }] : [])) inc(cnt, e.cat);
  }

  // A search keeps a category whose name matches, with all its subcategories, or the subcategories that match.
  const cq = catQ.trim().toLowerCase();
  const hit = (c: Category) => c.name.toLowerCase().includes(cq);
  // Subcategories sort within their category, which sorts by its own name or by its total count.
  const subCount = (id: number) => idx.subsOf(id).reduce((a, x) => a + (cnt.get(x.id) ?? 0), 0);
  const tops = sortBy(idx.tops.filter(c => c.type === catType), catSort, c => (cnt.get(c.id) ?? 0) + subCount(c.id))
    .map(c => ({ c, subs: sortBy(!cq || hit(c) ? idx.subsOf(c.id) : idx.subsOf(c.id).filter(hit), catSort, x => cnt.get(x.id) ?? 0) }))
    .filter(x => !cq || hit(x.c) || x.subs.length);

  function assignExisting() {
    if (!confirm('Give every existing transaction without a payee the payee its memo matches? Payees already set are kept.')) return;
    applyMatch.mutateAsync(undefined).then(
      n => toast(n ? `Assigned a payee to ${n} transaction${n === 1 ? '' : 's'}` : 'No transactions without a payee match a pattern'),
      e => toast(errorMessage(e)));
  }
  const pq = payeeQ.trim().toLowerCase();
  const payees = sortBy(data.payees.filter(p => !pq || p.name.toLowerCase().includes(pq)), payeeSort, p => pcnt.get(p.id) ?? 0);

  return (
    <>
      <Header title="Categories & payees" subtitle={`${data.cats.length} categories · ${data.payees.length} payees`}
        primary={<Button onClick={() => setDialog({ kind: tab })} disabled={!online}>{tab === 'cat' ? 'New category' : 'New payee'}<span className="kbd hide-m">N</span></Button>} />
      <div className="content">
        <div className="stack" style={{ maxWidth: 1100 }}>
          <div className="toolbar">
            <Seg value={tab} onChange={setTab} options={[['cat', 'Categories'], ['payee', 'Payees']] as const} />
          </div>

          {tab === 'cat' ? (
            <div className="panel">
              <div className="inline-form">
                <Seg value={catType} onChange={setCatType} options={[['exp', 'Expense'], ['inc', 'Income']] as const} />
                <input className="input" style={{ width: 200 }} placeholder="Search categories" value={catQ} onChange={e => setCatQ(e.target.value)} />
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <SortTh col="name" sort={catSort} onSort={setCatSort}>Category</SortTh>
                    <SortTh col="count" right sort={catSort} onSort={setCatSort} style={{ width: 110 }}>Transactions</SortTh>
                    <th style={{ width: 110 }} />
                  </tr>
                </thead>
                <tbody>
                  {tops.map(({ c, subs }) => {
                    const all = idx.subsOf(c.id);
                    const tc = (cnt.get(c.id) ?? 0) + all.reduce((a, x) => a + (cnt.get(x.id) ?? 0), 0);
                    const canDelete = tc === 0 && !all.length;
                    const color = c.color ?? OTHER;
                    return [
                      <tr className="group" key={c.id}>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Dot color={color} /><Link className="name-link" style={{ fontWeight: 600 }} to={txnsLink({ category: c.id })}>{c.name}</Link></span></td>
                        <td className="num" style={{ color: 'var(--ink2)' }}>{tc}</td>
                        <td className="r row-actions">
                          <button className="link" disabled={!online} onClick={() => setDialog({ kind: 'cat', category: c })}>Edit</button>
                          {canDelete && <button className="link danger" disabled={!online} onClick={() => run(delCat, c.id)}>Delete</button>}
                        </td>
                      </tr>,
                      ...subs.map(x => {
                        const n = cnt.get(x.id) ?? 0;
                        return (
                          <tr key={x.id}>
                            <td style={{ paddingLeft: 38 }}><Link className="name-link" to={txnsLink({ category: x.id })}>{x.name}</Link></td>
                            <td className="num" style={{ color: 'var(--ink2)' }}>{n}</td>
                            <td className="r row-actions">
                              <button className="link" disabled={!online} onClick={() => setDialog({ kind: 'cat', category: x })}>Edit</button>
                              {n === 0 && <button className="link danger" disabled={!online} onClick={() => run(delCat, x.id)}>Delete</button>}
                            </td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
              {!tops.length && <div className="empty">No categories{cq ? ' match this search' : ' yet'}.</div>}
            </div>
          ) : (
            <div className="panel">
              <div className="inline-form">
                <input className="input" style={{ width: 200 }} placeholder="Filter payees" value={payeeQ} onChange={e => setPayeeQ(e.target.value)} />
                <span className="muted hide-m" style={{ fontSize: 12 }}>New transactions get the payee whose memo pattern they contain (whole words, any case). Separate patterns with commas.</span>
                <div className="spacer hide-m" />
                <button className="btn sm" onClick={assignExisting} disabled={!online || applyMatch.isPending}
                  title="Give existing transactions without a payee the one their memo matches">Assign payees</button>
              </div>
              <div className="scroll-x">
                <table className="tbl tbl-fixed" style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <SortTh col="name" sort={payeeSort} onSort={setPayeeSort}>Payee</SortTh>
                      <th style={{ width: 320 }}>Matches memo</th>
                      <SortTh col="count" right sort={payeeSort} onSort={setPayeeSort} style={{ width: 110 }}>Transactions</SortTh>
                      <th style={{ width: 110 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {payees.map(p => {
                      const used = pcnt.get(p.id) ?? 0;
                      return (
                        <tr key={p.id}>
                          <td className="ell"><Link className="name-link" to={txnsLink({ payee: p.id })}>{p.name}</Link></td>
                          <td className="ell muted" title={p.match.join(', ')}>{p.match.join(', ')}</td>
                          <td className="num" style={{ color: 'var(--ink2)' }}>{used}</td>
                          <td className="r row-actions">
                            <button className="link" disabled={!online} onClick={() => setDialog({ kind: 'payee', payee: p })}>Edit</button>
                            {!used && <button className="link danger" disabled={!online} onClick={() => run(delPayee, p.id)}>Delete</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!payees.length && <div className="empty">No payees{pq ? ' match this filter' : ' yet'}.</div>}
            </div>
          )}
        </div>
      </div>
      {dialog?.kind === 'cat' && <CategoryModal category={dialog.category} type={catType} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'payee' && <PayeeModal payee={dialog.payee} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Column and direction, as one URL value: "-" in front means descending. */
const SORTS = ['name', '-name', 'count', '-count'] as const;
type Sort = (typeof SORTS)[number];

/** A copy of `list` sorted by name or by `count`, names breaking ties. */
function sortBy<T extends { name: string }>(list: T[], sort: Sort, count: (x: T) => number) {
  const dir = sort.startsWith('-') ? -1 : 1;
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  return [...list].sort((a, b) => sort.endsWith('count') ? dir * (count(a) - count(b)) || byName(a, b) : dir * byName(a, b));
}

/** A header that sorts by its column: names start A to Z, counts start with the most used. Same look as the data table's headers. */
function SortTh({ col, sort, onSort, right, style, children }: {
  col: 'name' | 'count'; sort: Sort; onSort: (s: Sort) => void; right?: boolean; style?: CSSProperties; children: ReactNode;
}) {
  const on = sort.endsWith(col);
  const desc = sort.startsWith('-');
  const first: Sort = col === 'name' ? 'name' : '-count';
  const next: Sort = !on ? first : desc ? (col === 'name' ? 'name' : 'count') : (col === 'name' ? '-name' : '-count');
  return (
    <th className={right ? 'r' : undefined} style={style} aria-sort={on ? (desc ? 'descending' : 'ascending') : undefined}>
      <button type="button" onClick={() => onSort(next)}
        className={cn('inline-flex max-w-full items-center gap-1 hover:text-foreground', right && 'flex-row-reverse', on && 'font-semibold text-foreground')}>
        <span className="truncate">{children}</span>
        {on && (desc ? <ArrowDown className="size-3 shrink-0" /> : <ArrowUp className="size-3 shrink-0" />)}
      </button>
    </th>
  );
}

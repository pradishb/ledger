import { useState } from 'react';
import type { ColumnDef, RowSelectionState } from '@tanstack/react-table';
import { useSearchParams } from 'react-router';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { Header } from '../components/common';
import { AccountModal } from '../components/AccountModal';
import { DataTable } from '../components/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { amountFor, balColor, describeTxn, sortTxnsAsc } from '../lib/ledger';
import { fdate, REG_RANGES, regFrom, type RegRange } from '../lib/dates';
import { errorMessage, fmt } from '../lib/format';
import { ACCOUNT_TYPES, PAYMENTS, type Txn } from '../lib/types';

export function Register() {
  // Filters live in the URL (/transactions?account=12&category=3), so links and Back work.
  const [params, setParams] = useSearchParams();
  const A = params.has('account') ? Number(params.get('account')) || -1 : 0;
  const C = Number(params.get('category')) || 0;
  const P = params.has('payee') ? Number(params.get('payee')) || 0 : -1;
  const K = (['exp', 'inc', 'xfer'] as const).find(k => k === params.get('kind')) ?? '';
  const setParam = (key: string, v: string) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (v) next.set(key, v); else next.delete(key);
    return next;
  }, { replace: true });
  const { data, idx, bal, today, openEdit, isMobile, online, toast } = useLedger();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<RegRange>('3m');
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const upd = useLedgerMutation(api.updateTxns);
  const tagM = useLedgerMutation(api.setTxnTags);
  const delM = useLedgerMutation(api.deleteTxns);
  const busy = upd.isPending || tagM.isPending || delM.isPending;
  const acct = A > 0 ? idx.accMap.get(A) : undefined;

  if (A && !acct) {
    return (
      <>
        <Header title="Account not found" />
        <div className="content"><div className="empty">This account doesn't exist. <button type="button" className="link" onClick={() => setParam('account', '')}>Show all transactions</button></div></div>
      </>
    );
  }

  // A category matches itself and its subcategories, on the transaction or any split line.
  const cats = C ? new Set([C, ...idx.subsOf(C).map(c => c.id)]) : null;
  const kindOf = (t: Txn) => (t.xfer ? 'xfer' : t.amount < 0 ? 'exp' : 'inc');

  const list = data.txns.filter(t => !A || t.acc === A || t.xfer === A).sort(sortTxnsAsc);
  const from = regFrom(range, today);
  const needle = q.trim().toLowerCase();
  let run = acct?.opening ?? 0;
  let tin = 0, tout = 0;
  const rows: { t: Txn; amt: number; run: number }[] = [];

  for (const t of list) {
    const amt = A ? amountFor(t, A) : t.amount;
    run += amt;
    if (t.date < from) continue;
    if (K && kindOf(t) !== K) continue;
    if (P >= 0 && (t.xfer || t.payee !== P)) continue;
    if (cats && !(cats.has(t.cat) || t.splits?.some(s => cats.has(s.cat)))) continue;
    if (needle) {
      const hay = [
        idx.payMap.get(t.payee)?.name, t.memo, t.info, idx.catLabel(t.cat),
        ...(t.splits ?? []).map(s => `${idx.catLabel(s.cat)} ${s.memo}`),
        t.tags.join(' '), (Math.abs(t.amount) / 100).toFixed(2),
        t.xfer ? `transfer ${idx.accMap.get(t.xfer)?.name} ${idx.accMap.get(t.acc)?.name}` : '',
      ].join(' ').toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    // One account: its own currency. Every account: converted to the home currency.
    if (!(t.xfer && !A)) { const v = A ? amt : idx.toDisp(t.acc, amt); if (v > 0) tin += v; else tout += v; }
    rows.push({ t, amt, run });
  }
  rows.reverse();

  const title = acct ? acct.name : 'Transactions';
  const subtitle = acct
    ? [ACCOUNT_TYPES.find(x => x[0] === acct.type)?.[1], acct.group].filter(Boolean).join(' · ')
    : 'Every account';
  const anyFilter = !!(A || C || P >= 0 || K || needle);
  const shownAccounts = data.accounts.filter(a => !a.hidden).sort((x, y) => x.name.localeCompare(y.name));
  const hiddenAccounts = data.accounts.filter(a => a.hidden).sort((x, y) => x.name.localeCompare(y.name));
  const b = acct ? bal.get(acct.id) : undefined;
  // One account: its own currency. Every account: rows in their own currency, totals in the display currency.
  const acur = acct ? idx.accCur(acct.id) : idx.disp;
  const rowCur = (t: Txn) => (acct ? acur : idx.accCur(t.acc));
  const tagText = (t: Txn) => t.tags.map(x => '#' + x).join(' ');
  // Size the money columns to their longest value (mono 12px is 7.2px a character), so big
  // amounts never spill into the next column.
  const monoW = (n: number, pad: number, min: number) => Math.max(min, Math.ceil(n * 7.2) + pad);
  // Padding: 8px left plus up to 14px right (the last column), with a little to spare.
  const amtW = monoW(Math.max(0, ...rows.map(r => fmt(r.amt, rowCur(r.t)).length)), 30, 104);
  const lastW = A ? monoW(Math.max(0, ...rows.map(r => fmt(r.run, acur).length)), 30, 112) : 112;

  type Row = (typeof rows)[number] & { v: ReturnType<typeof describeTxn> };
  const tableRows: Row[] = rows.map(r => ({ ...r, v: describeTxn(r.t, r.amt, A, idx) }));
  const byDate = (x: Row, y: Row) => (x.t.date < y.t.date ? -1 : x.t.date > y.t.date ? 1 : x.t.id - y.t.id);
  const text = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: 'base' });

  // One account shows its running balance; every account shows which account each row is in.
  // Rows start newest first; a header click sorts, a third click goes back to that order.
  const columns: ColumnDef<Row, unknown>[] = [
    { id: 'date', header: 'Date', size: 90, accessorFn: r => r.t.date, sortingFn: (a, b) => byDate(a.original, b.original),
      meta: { cellClass: 'text-xs text-ink2' }, cell: ({ row }) => fdate(row.original.t.date, today) },
    { id: 'payment', header: 'Payment', size: 120, meta: { cellClass: 'text-xs text-muted-foreground' },
      accessorFn: r => [r.t.pay === 'None' ? '' : r.t.pay, r.t.info ? '#' + r.t.info : ''].filter(Boolean).join(' ') },
    { id: 'payee', header: 'Payee', accessorFn: r => r.v.payee, meta: { flex: true }, sortingFn: (a, b) => text(a.original.v.payee, b.original.v.payee) },
    { id: 'category', header: 'Category', accessorFn: r => r.v.category, sortingFn: (a, b) => text(a.original.v.category, b.original.v.category),
      meta: { flex: true, cellClass: 'text-xs', cellStyle: r => ({ color: r.v.catColor }) } },
    { id: 'memo', header: 'Memo', accessorFn: r => r.t.memo, meta: { flex: true, cellClass: 'text-xs text-ink2' } },
    ...(A ? [] : [{ id: 'account', header: 'Account', size: 120, accessorFn: (r: Row) => idx.accMap.get(r.t.acc)?.name ?? '',
      meta: { cellClass: 'text-xs text-muted-foreground' } } satisfies ColumnDef<Row, unknown>]),
    { id: 'tags', header: 'Tags', size: 110, accessorFn: r => tagText(r.t), enableSorting: false, meta: { cellClass: 'text-xs text-muted-foreground' } },
    { id: 'amount', header: 'Amount', size: amtW, sortDescFirst: true, accessorFn: r => (A ? r.amt : idx.toDisp(r.t.acc, r.amt)),
      meta: { align: 'right', cellClass: 'num', cellStyle: r => ({ color: r.v.amtColor }) }, cell: ({ row }) => fmt(row.original.amt, rowCur(row.original.t)) },
    ...(A ? [{ id: 'balance', header: 'Balance', size: lastW, enableSorting: false,
      meta: { align: 'right' as const, cellClass: 'num', cellStyle: (r: Row) => ({ color: balColor(r.run) }) },
      cell: ({ row }: { row: { original: Row } }) => fmt(row.original.run, acur) } satisfies ColumnDef<Row, unknown>] : []),
  ];

  // Selection. Only rows on screen count, so a search or range change never edits hidden rows.
  const sel = rows.filter(r => selection[r.t.id]).map(r => r.t);
  const clearPick = () => setSelection({});

  // Category and payee don't apply to transfers, and a split's categories live on its lines.
  const plain = sel.filter(t => !t.xfer && !t.splits);
  const noPayee = sel.filter(t => !t.xfer);
  const done = (n: number, what: string, skipped = 0, why = '') => {
    toast(`${what} ${n} transaction${n === 1 ? '' : 's'}${skipped ? `; skipped ${skipped} (${why})` : ''}`);
    clearPick();
  };
  async function act(fn: () => Promise<unknown>, after: () => void) {
    try { await fn(); after(); } catch (e) { toast(errorMessage(e)); }
  }
  const setCategory = (cat: number) => plain.length
    ? act(() => upd.mutateAsync({ ids: plain.map(t => t.id), patch: { category_id: cat } }), () => done(plain.length, 'Updated', sel.length - plain.length, 'transfers or splits'))
    : toast('Category can only be set on transactions that aren\'t transfers or splits');
  const setPayee = (p: number) => noPayee.length
    ? act(() => upd.mutateAsync({ ids: noPayee.map(t => t.id), patch: { payee_id: p || null } }), () => done(noPayee.length, 'Updated', sel.length - noPayee.length, 'transfers'))
    : toast('Transfers have no payee');
  const setPayment = (p: string) =>
    act(() => upd.mutateAsync({ ids: sel.map(t => t.id), patch: { payment: p } }), () => done(sel.length, 'Updated'));
  function changeTags(add: boolean) {
    const raw = prompt(add ? 'Tag to add to the selected transactions:' : 'Tag to remove from the selected transactions:');
    const tag = raw?.trim().replace(/^#/, '');
    if (!tag) return;
    const byTags = new Map<string, { ids: number[]; tags: string[] }>();
    let n = 0;
    for (const t of sel) {
      const has = t.tags.includes(tag);
      if (add === has) continue;
      const tags = add ? [...t.tags, tag] : t.tags.filter(x => x !== tag);
      const k = JSON.stringify(tags);
      const g = byTags.get(k) ?? { ids: [], tags };
      g.ids.push(t.id); byTags.set(k, g); n++;
    }
    if (!n) return toast(add ? `All of them already have #${tag}` : `None of them have #${tag}`);
    act(() => tagM.mutateAsync([...byTags.values()]), () => done(n, add ? `Tagged #${tag} on` : `Removed #${tag} from`));
  }
  function remove() {
    if (!confirm(`Delete ${sel.length} transaction${sel.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    act(() => delM.mutateAsync(sel.map(t => t.id)), () => done(sel.length, 'Deleted'));
  }
  const catOpts = (type: 'exp' | 'inc') => idx.tops.filter(c => c.type === type).flatMap(c => [
    <option key={c.id} value={c.id}>{c.name}</option>,
    ...idx.subsOf(c.id).map(s => <option key={s.id} value={s.id}>{'\u00a0\u00a0\u00a0\u00a0' + s.name}</option>),
  ]);

  const filters = <>
    <Input type="search" className="h-8 w-60" value={q} onChange={e => setQ(e.target.value)} placeholder="Search payee, memo, category, amount" aria-label="Search" />
    <select className="select" value={range} onChange={e => setRange(e.target.value as RegRange)} aria-label="Date range">
      {REG_RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
    <select className="select" value={A > 0 ? A : ''} onChange={e => setParam('account', e.target.value)} aria-label="Account">
      <option value="">All accounts</option>
      {shownAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      {hiddenAccounts.length > 0 && <optgroup label="Hidden">{hiddenAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
    </select>
    <select className="select" value={K} onChange={e => setParam('kind', e.target.value)} aria-label="Type">
      <option value="">All types</option>
      <option value="exp">Expenses</option>
      <option value="inc">Income</option>
      <option value="xfer">Transfers</option>
    </select>
    <select className="select" value={C || ''} onChange={e => setParam('category', e.target.value)} aria-label="Category">
      <option value="">All categories</option>
      <optgroup label="Expense">{catOpts('exp')}</optgroup>
      <optgroup label="Income">{catOpts('inc')}</optgroup>
    </select>
    <select className="select" value={P >= 0 ? P : ''} onChange={e => setParam('payee', e.target.value)} aria-label="Payee">
      <option value="">All payees</option>
      <option value="0">— No payee —</option>
      {[...data.payees].sort((x, y) => x.name.localeCompare(y.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
    {anyFilter && (
      <Button variant="link" size="sm" className="h-auto px-0" onClick={() => { setQ(''); setParams(new URLSearchParams(), { replace: true }); }}>Clear filters</Button>
    )}
  </>;
  const balanceNote = b !== undefined && (
    <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
      Balance<span className="font-mono text-[12.5px] font-medium" style={{ color: balColor(b) }}>{fmt(b, acur)}</span>
    </span>
  );

  return (
    <>
      <Header title={title} subtitle={subtitle}>
        {acct && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit account</Button>}
      </Header>
      {acct && editing && <AccountModal account={acct} onClose={() => setEditing(false)} />}
      <div className="content">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isMobile && <div className="toolbar">{filters}{balanceNote}</div>}
          <div className="panel">
            {sel.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b bg-primary/10 px-3.5 py-2 text-[12.5px]" role="toolbar" aria-label="Bulk edit">
                <b>{sel.length} selected</b>
                <select className="select" value="" disabled={!online || busy} aria-label="Set category" onChange={e => e.target.value && setCategory(+e.target.value)}>
                  <option value="">Category…</option>
                  <optgroup label="Expense">{catOpts('exp')}</optgroup>
                  <optgroup label="Income">{catOpts('inc')}</optgroup>
                </select>
                <select className="select" value="" disabled={!online || busy} aria-label="Set payee" onChange={e => e.target.value && setPayee(+e.target.value)}>
                  <option value="">Payee…</option>
                  <option value="0">— No payee —</option>
                  {[...data.payees].sort((x, y) => x.name.localeCompare(y.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="select" value="" disabled={!online || busy} aria-label="Set payment" onChange={e => e.target.value && setPayment(e.target.value)}>
                  <option value="">Payment…</option>
                  {PAYMENTS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <Button variant="outline" size="sm" disabled={!online || busy} onClick={() => changeTags(true)}>Add tag…</Button>
                <Button variant="outline" size="sm" disabled={!online || busy} onClick={() => changeTags(false)}>Remove tag…</Button>
                <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={!online || busy} onClick={remove}>Delete</Button>
                <span className="flex-1" />
                <Button variant="link" size="sm" className="h-auto px-0" onClick={clearPick}>Clear selection</Button>
              </div>
            )}
            {isMobile ? (
              <div className="mlist">
                {rows.map(({ t, amt, run }) => {
                  const v = describeTxn(t, amt, A, idx);
                  return (
                    <div className="mrow" key={t.id} onClick={() => openEdit(t)} style={{ opacity: t.date > today ? 0.55 : 1 }}>
                      <div className="p">{v.payee}</div>
                      <div className="a" style={{ color: v.amtColor }}>{fmt(amt, rowCur(t))}</div>
                      <div className="m">
                        {fdate(t.date, today)} · <span style={{ color: v.catColor }}>{v.category}</span>
                        {!A && ` · ${idx.accMap.get(t.acc)?.name ?? ''}`}
                        {t.memo && ` · ${t.memo}`}
                      </div>
                      <div className="b" style={{ color: A ? balColor(run) : 'var(--ink3)' }}>{A ? fmt(run, acur) : tagText(t)}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <DataTable id="transactions" data={tableRows} columns={columns} getRowId={r => String(r.t.id)}
                selection={selection} onSelectionChange={setSelection}
                onRowClick={r => openEdit(r.t)} rowTitle="Click to edit"
                rowClassName={r => (r.t.date > today ? 'opacity-55' : '')}
                toolbar={filters} toolbarEnd={balanceNote} />
            )}
            {!rows.length && <div className="empty">No transactions match these filters.</div>}
            <div className="foot">
              <span>{rows.length} transaction{rows.length === 1 ? '' : 's'}</span>
              <span>In <span className="mono" style={{ color: 'var(--inc)' }}>{fmt(tin, acur)}</span></span>
              <span>Out <span className="mono" style={{ color: 'var(--out)' }}>{fmt(tout, acur)}</span></span>
              <div className="spacer" />
              <span>{isMobile ? 'Tap a row to edit.' : 'Click a row to edit. Tick rows (Shift for a range) to edit several.'}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

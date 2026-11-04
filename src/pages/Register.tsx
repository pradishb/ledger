import { useState } from 'react';
import { useParams } from 'react-router';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { Header } from '../components/ui';
import { AccountModal } from '../components/AccountModal';
import { amountFor, balColor, describeTxn, sortTxnsAsc } from '../lib/ledger';
import { fdate, REG_RANGES, regFrom, type RegRange } from '../lib/dates';
import { errorMessage, fmt } from '../lib/format';
import { ACCOUNT_TYPES, PAYMENTS, type Txn } from '../lib/types';

export function Register() {
  const params = useParams();
  const A = params.id ? Number(params.id) || -1 : 0;
  const { data, idx, bal, today, openEdit, isMobile, online, toast } = useLedger();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<RegRange>('3m');
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState(0);
  const upd = useLedgerMutation(api.updateTxns);
  const tagM = useLedgerMutation(api.setTxnTags);
  const delM = useLedgerMutation(api.deleteTxns);
  const busy = upd.isPending || tagM.isPending || delM.isPending;
  const acct = A > 0 ? idx.accMap.get(A) : undefined;

  if (A && !acct) {
    return (
      <>
        <Header title="Account not found" />
        <div className="content"><div className="empty">This account doesn't exist.</div></div>
      </>
    );
  }

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

  const title = acct ? acct.name : 'All transactions';
  const subtitle = acct
    ? [ACCOUNT_TYPES.find(x => x[0] === acct.type)?.[1], acct.group].filter(Boolean).join(' · ')
    : 'Every account';
  const b = acct ? bal.get(acct.id) : undefined;
  // One account: its own currency. Every account: rows in their own currency, totals in the display currency.
  const acur = acct ? idx.accCur(acct.id) : idx.disp;
  const rowCur = (t: Txn) => (acct ? acur : idx.accCur(t.acc));
  const tagText = (t: Txn) => t.tags.map(x => '#' + x).join(' ');
  // Size the money columns to their longest value (mono 12px is 7.2px a character), so big
  // amounts never spill into the next column.
  const monoW = (n: number, pad: number, min: number) => Math.max(min, Math.ceil(n * 7.2) + pad);
  const amtW = monoW(Math.max(0, ...rows.map(r => fmt(r.amt, rowCur(r.t)).length)), 18, 104);
  const lastW = A ? monoW(Math.max(0, ...rows.map(r => fmt(r.run, acur).length)), 24, 112) : 112;

  // Selection. Only rows on screen count, so a search or range change never edits hidden rows.
  const sel = rows.filter(r => picked.has(r.t.id)).map(r => r.t);
  const allPicked = rows.length > 0 && sel.length === rows.length;
  const clearPick = () => { setPicked(new Set()); setAnchor(0); };
  function pick(id: number, shift: boolean) {
    setPicked(prev => {
      const next = new Set(prev);
      const on = !prev.has(id);
      // Shift-click sets every row between the last clicked one and this one.
      const a = rows.findIndex(r => r.t.id === anchor), b = rows.findIndex(r => r.t.id === id);
      if (shift && a >= 0 && b >= 0) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) on ? next.add(rows[i].t.id) : next.delete(rows[i].t.id);
      } else if (on) next.add(id); else next.delete(id);
      return next;
    });
    setAnchor(id);
  }

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

  return (
    <>
      <Header title={title} subtitle={subtitle}>
        {acct && <button type="button" className="btn sm" onClick={() => setEditing(true)}>Edit account</button>}
      </Header>
      {acct && editing && <AccountModal account={acct} onClose={() => setEditing(false)} />}
      <div className="content">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="toolbar">
            <input className="input" style={{ width: 280 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Search payee, memo, category, amount" type="search" />
            <select className="select" value={range} onChange={e => setRange(e.target.value as RegRange)}>
              {REG_RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <div className="spacer" />
            {b !== undefined && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11.5, color: 'var(--ink3)' }}>
                Balance<span className="mono" style={{ fontSize: 12.5, color: balColor(b), fontWeight: 500 }}>{fmt(b, acur)}</span>
              </span>
            )}
          </div>

          <div className="panel">
            {sel.length > 0 && (
              <div className="bulk-bar" role="toolbar" aria-label="Bulk edit">
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
                <button type="button" className="btn sm" disabled={!online || busy} onClick={() => changeTags(true)}>Add tag…</button>
                <button type="button" className="btn sm" disabled={!online || busy} onClick={() => changeTags(false)}>Remove tag…</button>
                <button type="button" className="btn sm danger" disabled={!online || busy} onClick={remove}>Delete</button>
                <span className="spacer" />
                <button type="button" className="link" onClick={clearPick}>Clear selection</button>
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
              <div className="scroll-x">
                <table className="tbl fixed" style={{ minWidth: 798 + amtW + lastW }}>
                  <thead>
                    <tr>
                      <th className="pick">
                        <input type="checkbox" checked={allPicked} disabled={!rows.length}
                          ref={el => { if (el) el.indeterminate = sel.length > 0 && !allPicked; }}
                          onChange={() => (allPicked ? clearPick() : setPicked(new Set(rows.map(r => r.t.id))))}
                          aria-label={allPicked ? 'Select none' : 'Select all shown'} />
                      </th>
                      <th style={{ width: 90 }}>Date</th>
                      <th style={{ width: 120 }}>Payment</th>
                      <th>Payee</th>
                      <th>Category</th>
                      <th>Memo</th>
                      <th style={{ width: 110 }}>{A ? 'Tags' : 'Account'}</th>
                      <th className="r" style={{ width: amtW }}>Amount</th>
                      <th className="r" style={{ width: lastW }}>{A ? 'Balance' : 'Tags'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ t, amt, run }) => {
                      const v = describeTxn(t, amt, A, idx);
                      const payment = [t.pay === 'None' ? '' : t.pay, t.info ? '#' + t.info : ''].filter(Boolean).join(' ');
                      return (
                        <tr key={t.id} className={`reg-row clickable${picked.has(t.id) ? ' picked' : ''}`} style={{ opacity: t.date > today ? 0.55 : 1 }}
                          onClick={() => openEdit(t)} title="Click to edit">
                          <td className="pick" onClick={e => { e.stopPropagation(); pick(t.id, e.shiftKey); }}>
                            <input type="checkbox" checked={picked.has(t.id)} readOnly tabIndex={-1} aria-label="Select" />
                          </td>
                          <td className="small" style={{ color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{fdate(t.date, today)}</td>
                          <td className="small muted ell">{payment}</td>
                          <td className="ell">{v.payee}</td>
                          <td className="small ell" style={{ color: v.catColor }}>{v.category}</td>
                          <td className="small ell" style={{ color: 'var(--ink2)' }}>{t.memo}</td>
                          <td className="small muted ell">{A ? tagText(t) : idx.accMap.get(t.acc)?.name}</td>
                          <td className="num" style={{ color: v.amtColor }}>{fmt(amt, rowCur(t))}</td>
                          <td className="num" style={{ color: A ? balColor(run) : 'var(--ink3)' }}>{A ? fmt(run, acur) : tagText(t)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!rows.length && <div className="empty">No transactions match these filters.</div>}
            <div className="foot">
              <span>{rows.length} transaction{rows.length === 1 ? '' : 's'}</span>
              <span>In <span className="mono" style={{ color: 'var(--pos)' }}>{fmt(tin, acur)}</span></span>
              <span>Out <span className="mono" style={{ color: 'var(--ink)' }}>{fmt(tout, acur)}</span></span>
              <div className="spacer" />
              <span>{isMobile ? 'Tap a row to edit.' : 'Click a row to edit. Tick rows (Shift for a range) to edit several.'}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

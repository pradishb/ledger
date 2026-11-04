import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useLedger } from '../data/context';
import { Header } from '../components/ui';
import { amountFor, balColor, describeTxn, sortTxnsAsc } from '../lib/ledger';
import { fdate, REG_RANGES, regFrom, type RegRange } from '../lib/dates';
import { fmt } from '../lib/format';
import { ACCOUNT_TYPES, type Txn } from '../lib/types';

export function Register() {
  const params = useParams();
  const A = params.id ? Number(params.id) || -1 : 0;
  const { data, idx, bal, today, openEdit, isMobile } = useLedger();
  const [q, setQ] = useState('');
  const [range, setRange] = useState<RegRange>('3m');
  const [sel, setSel] = useState(0);
  const acct = A > 0 ? idx.accMap.get(A) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName?.toLowerCase();
      if (e.key !== 'Enter' || !sel || ['input', 'select', 'textarea', 'button'].includes(tag)) return;
      if (document.querySelector('.scrim')) return;
      const t = data.txns.find(x => x.id === sel);
      if (t) openEdit(t);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, data.txns, openEdit]);

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
    ? [ACCOUNT_TYPES.find(x => x[0] === acct.type)?.[1], acct.institution].filter(Boolean).join(' · ')
    : 'Every account';
  const b = acct ? bal.get(acct.id) : undefined;
  // One account: its own currency. Every account: rows in their own currency, totals in the display currency.
  const acur = acct ? idx.accCur(acct.id) : idx.disp;
  const rowCur = (t: Txn) => (acct ? acur : idx.accCur(t.acc));
  const tagText = (t: Txn) => t.tags.map(x => '#' + x).join(' ');

  return (
    <>
      <Header title={title} subtitle={subtitle} />
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
                <table className="tbl fixed" style={{ minWidth: 980 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Date</th>
                      <th style={{ width: 120 }}>Payment</th>
                      <th>Payee</th>
                      <th>Category</th>
                      <th>Memo</th>
                      <th style={{ width: 110 }}>{A ? 'Tags' : 'Account'}</th>
                      <th className="r" style={{ width: 104 }}>Amount</th>
                      <th className="r" style={{ width: 112 }}>{A ? 'Balance' : 'Tags'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ t, amt, run }) => {
                      const v = describeTxn(t, amt, A, idx);
                      const payment = [t.pay === 'None' ? '' : t.pay, t.info ? '#' + t.info : ''].filter(Boolean).join(' ');
                      return (
                        <tr key={t.id} className={`reg-row${sel === t.id ? ' sel' : ''}`} style={{ opacity: t.date > today ? 0.55 : 1 }}
                          onClick={() => setSel(t.id)} onDoubleClick={() => openEdit(t)}>
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
              <span>{isMobile ? 'Tap a row to edit.' : 'Double-click a row to edit.'}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

import { useState } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { Dot, Header, Seg } from '../components/ui';
import { rangeDates } from '../lib/dates';
import { errorMessage, fmt } from '../lib/format';
import { OTHER, PALETTE, PAYMENTS, type CatType } from '../lib/types';

export function CategoriesPayees() {
  const { data, idx, today, online, toast } = useLedger();
  const [tab, setTab] = useState<'cat' | 'payee'>('cat');
  const [catType, setCatType] = useState<CatType>('exp');
  const [newCat, setNewCat] = useState('');
  const [newParent, setNewParent] = useState('0');
  const [newPayee, setNewPayee] = useState('');
  const [payeeQ, setPayeeQ] = useState('');

  const addCat = useLedgerMutation(api.addCategory);
  const delCat = useLedgerMutation(api.deleteCategory);
  const addPayee = useLedgerMutation(api.addPayee);
  const updPayee = useLedgerMutation(api.updatePayee);
  const delPayee = useLedgerMutation(api.deletePayee);

  const run = <A,>(m: { mutateAsync: (a: A) => Promise<unknown> }, arg: A, ok?: string) =>
    m.mutateAsync(arg).then(() => ok && toast(ok), e => toast(errorMessage(e)));

  // Usage counts (all time) and 12-month totals.
  const [f12, t12] = rangeDates('l12m', today);
  const cnt = new Map<number, number>(), tot = new Map<number, number>();
  const pcnt = new Map<number, number>(), ptot = new Map<number, number>();
  const inc = (m: Map<number, number>, k: number, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const t of data.txns) {
    if (t.payee) inc(pcnt, t.payee, 1);
    const entries = t.splits ?? (t.cat ? [{ cat: t.cat, amount: t.amount }] : []);
    for (const e of entries) {
      inc(cnt, e.cat, 1);
      if (t.date >= f12 && t.date <= t12) {
        const v = idx.toDisp(t.acc, e.amount);
        inc(tot, e.cat, v);
        if (t.payee) inc(ptot, t.payee, v);
      }
    }
  }

  const sg = catType === 'exp' ? -1 : 1;
  const usedAsDefault = (id: number) => data.payees.some(p => p.defCat === id);
  const tops = idx.tops.filter(c => c.type === catType);

  function submitCat() {
    const name = newCat.trim();
    if (!name) return;
    const parent = +newParent;
    run(addCat, { name, parent, type: catType, color: parent ? null : PALETTE[idx.tops.length % PALETTE.length] }, `Added “${name}”`)
      .then(() => setNewCat(''));
  }
  function submitPayee() {
    const name = newPayee.trim();
    if (!name) return;
    if (data.payees.some(p => p.name.toLowerCase() === name.toLowerCase())) return toast('That payee already exists');
    run(addPayee, name, `Added “${name}”`).then(() => setNewPayee(''));
  }

  const catOpts = [{ v: '0', l: '— None —' }];
  for (const c of idx.tops) {
    catOpts.push({ v: String(c.id), l: c.name });
    for (const s of idx.subsOf(c.id)) catOpts.push({ v: String(s.id), l: '    ' + s.name });
  }
  const pq = payeeQ.trim().toLowerCase();
  const payees = [...data.payees].sort((a, b) => a.name.localeCompare(b.name)).filter(p => !pq || p.name.toLowerCase().includes(pq));

  return (
    <>
      <Header title="Categories & payees" subtitle={`${data.cats.length} categories · ${data.payees.length} payees`} />
      <div className="content">
        <div className="stack" style={{ maxWidth: 1100 }}>
          <div className="toolbar">
            <Seg value={tab} onChange={setTab} options={[['cat', 'Categories'], ['payee', 'Payees']] as const} />
          </div>

          {tab === 'cat' ? (
            <div className="panel">
              <div className="inline-form">
                <Seg value={catType} onChange={k => { setCatType(k); setNewParent('0'); }} options={[['exp', 'Expense'], ['inc', 'Income']] as const} />
                <div className="spacer hide-m" />
                <input className="input" style={{ width: 200 }} placeholder="New category name" value={newCat}
                  onChange={e => setNewCat(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitCat()} />
                <select className="select" value={newParent} onChange={e => setNewParent(e.target.value)}>
                  <option value="0">Top level</option>
                  {tops.map(c => <option key={c.id} value={c.id}>Under {c.name}</option>)}
                </select>
                <button className="btn sm" onClick={submitCat} disabled={!online || addCat.isPending}>Add</button>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="r hide-m" style={{ width: 110 }}>Transactions</th>
                    <th className="r" style={{ width: 130 }}>Last 12 months</th>
                    <th className="r hide-m" style={{ width: 110 }}>Avg / mo</th>
                    <th style={{ width: 70 }} />
                  </tr>
                </thead>
                <tbody>
                  {tops.map(c => {
                    const subs = idx.subsOf(c.id);
                    const tc = (cnt.get(c.id) ?? 0) + subs.reduce((a, x) => a + (cnt.get(x.id) ?? 0), 0);
                    const tt = sg * ((tot.get(c.id) ?? 0) + subs.reduce((a, x) => a + (tot.get(x.id) ?? 0), 0));
                    const canDelete = tc === 0 && !subs.length && !usedAsDefault(c.id);
                    const color = c.color ?? OTHER;
                    return [
                      <tr className="group" key={c.id}>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Dot color={color} /><b style={{ fontWeight: 600 }}>{c.name}</b></span></td>
                        <td className="num hide-m" style={{ color: 'var(--ink2)' }}>{tc}</td>
                        <td className="num" style={{ fontWeight: 600 }}>{fmt(tt, idx.disp)}</td>
                        <td className="num hide-m" style={{ color: 'var(--ink2)' }}>{fmt(Math.round(tt / 12), idx.disp)}</td>
                        <td className="r">{canDelete && <button className="link danger" disabled={!online} onClick={() => run(delCat, c.id)}>Delete</button>}</td>
                      </tr>,
                      ...subs.map(x => {
                        const n = cnt.get(x.id) ?? 0, sv = sg * (tot.get(x.id) ?? 0);
                        return (
                          <tr key={x.id}>
                            <td style={{ paddingLeft: 38 }}>{x.name}</td>
                            <td className="num hide-m" style={{ color: 'var(--ink2)' }}>{n}</td>
                            <td className="num">{fmt(sv, idx.disp)}</td>
                            <td className="num hide-m" style={{ color: 'var(--ink2)' }}>{fmt(Math.round(sv / 12), idx.disp)}</td>
                            <td className="r">{n === 0 && !usedAsDefault(x.id) && <button className="link danger" disabled={!online} onClick={() => run(delCat, x.id)}>Delete</button>}</td>
                          </tr>
                        );
                      }),
                    ];
                  })}
                </tbody>
              </table>
              {!tops.length && <div className="empty">No categories yet.</div>}
            </div>
          ) : (
            <div className="panel">
              <div className="inline-form">
                <input className="input" style={{ width: 200 }} placeholder="Filter payees" value={payeeQ} onChange={e => setPayeeQ(e.target.value)} />
                <span className="muted hide-m" style={{ fontSize: 12 }}>Default category and payment fill in automatically when you pick a payee.</span>
                <div className="spacer hide-m" />
                <input className="input" style={{ width: 200 }} placeholder="New payee name" value={newPayee}
                  onChange={e => setNewPayee(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitPayee()} />
                <button className="btn sm" onClick={submitPayee} disabled={!online || addPayee.isPending}>Add</button>
              </div>
              <div className="scroll-x">
                <table className="tbl fixed" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>Payee</th>
                      <th style={{ width: 200 }}>Default category</th>
                      <th style={{ width: 160 }}>Default payment</th>
                      <th className="r" style={{ width: 100 }}>Transactions</th>
                      <th className="r" style={{ width: 120 }}>Last 12 months</th>
                      <th style={{ width: 64 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {payees.map(p => {
                      const tt = ptot.get(p.id) ?? 0;
                      const used = pcnt.get(p.id) ?? 0;
                      return (
                        <tr key={p.id}>
                          <td className="ell">{p.name}</td>
                          <td>
                            <select className="select" style={{ width: '100%', height: 26, fontSize: 12 }} value={p.defCat} disabled={!online}
                              onChange={e => run(updPayee, { id: p.id, defCat: +e.target.value })}>
                              {catOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="select" style={{ width: '100%', height: 26, fontSize: 12 }} value={p.defPay} disabled={!online}
                              onChange={e => run(updPayee, { id: p.id, defPay: e.target.value })}>
                              {PAYMENTS.map(x => <option key={x} value={x}>{x}</option>)}
                            </select>
                          </td>
                          <td className="num" style={{ color: 'var(--ink2)' }}>{used}</td>
                          <td className="num" style={{ color: tt > 0 ? 'var(--pos)' : 'var(--ink)' }}>{fmt(tt, idx.disp)}</td>
                          <td className="r">{!used && <button className="link danger" disabled={!online} onClick={() => run(delPayee, p.id)}>Delete</button>}</td>
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
    </>
  );
}

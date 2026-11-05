import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { Dot, Header, Seg, useUrlChoice, useUrlText } from '../components/common';
import { rangeDates } from '../lib/dates';
import { txnsLink } from '../lib/links';
import { errorMessage, fmt } from '../lib/format';
import { OTHER, PALETTE, type CatType } from '../lib/types';

export function CategoriesPayees() {
  const { data, idx, today, online, toast } = useLedger();
  const [tab, setTab] = useUrlChoice('tab', ['cat', 'payee'] as const, 'cat');
  const [catType, setCatType] = useUrlChoice<CatType>('type', ['exp', 'inc'], 'exp');
  const [newCat, setNewCat] = useState('');
  const [newParent, setNewParent] = useState('0');
  const [newPayee, setNewPayee] = useState('');
  const [payeeQ, setPayeeQ] = useUrlText('q');

  const addCat = useLedgerMutation(api.addCategory);
  const delCat = useLedgerMutation(api.deleteCategory);
  const addPayee = useLedgerMutation(api.addPayee);
  const updPayee = useLedgerMutation(api.updatePayee);
  const delPayee = useLedgerMutation(api.deletePayee);
  const applyMatch = useLedgerMutation(api.applyPayeeMatch);

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

  function assignExisting() {
    if (!confirm('Give every existing transaction without a payee the payee its memo matches? Payees already set are kept.')) return;
    applyMatch.mutateAsync(undefined).then(
      n => toast(n ? `Assigned a payee to ${n} transaction${n === 1 ? '' : 's'}` : 'No transactions without a payee match a pattern'),
      e => toast(errorMessage(e)));
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
                    const canDelete = tc === 0 && !subs.length;
                    const color = c.color ?? OTHER;
                    return [
                      <tr className="group" key={c.id}>
                        <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Dot color={color} /><Link className="name-link" style={{ fontWeight: 600 }} to={txnsLink({ category: c.id })}>{c.name}</Link></span></td>
                        <td className="num hide-m" style={{ color: 'var(--ink2)' }}>{tc}</td>
                        <td className="num" style={{ fontWeight: 600, color: tt ? (catType === 'exp' ? 'var(--out)' : 'var(--inc)') : 'var(--ink3)' }}>{fmt(tt, idx.disp)}</td>
                        <td className="num hide-m" style={{ color: 'var(--ink2)' }}>{fmt(Math.round(tt / 12), idx.disp)}</td>
                        <td className="r">{canDelete && <button className="link danger" disabled={!online} onClick={() => run(delCat, c.id)}>Delete</button>}</td>
                      </tr>,
                      ...subs.map(x => {
                        const n = cnt.get(x.id) ?? 0, sv = sg * (tot.get(x.id) ?? 0);
                        return (
                          <tr key={x.id}>
                            <td style={{ paddingLeft: 38 }}><Link className="name-link" to={txnsLink({ category: x.id })}>{x.name}</Link></td>
                            <td className="num hide-m" style={{ color: 'var(--ink2)' }}>{n}</td>
                            <td className="num" style={{ color: sv ? (catType === 'exp' ? 'var(--out)' : 'var(--inc)') : 'var(--ink3)', opacity: 0.8 }}>{fmt(sv, idx.disp)}</td>
                            <td className="num hide-m" style={{ color: 'var(--ink2)' }}>{fmt(Math.round(sv / 12), idx.disp)}</td>
                            <td className="r">{n === 0 && <button className="link danger" disabled={!online} onClick={() => run(delCat, x.id)}>Delete</button>}</td>
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
                <span className="muted hide-m" style={{ fontSize: 12 }}>New transactions get the payee whose memo pattern they contain (whole words, any case). Separate patterns with commas.</span>
                <div className="spacer hide-m" />
                <input className="input" style={{ width: 200 }} placeholder="New payee name" value={newPayee}
                  onChange={e => setNewPayee(e.target.value)} onKeyDown={e => e.key === 'Enter' && submitPayee()} />
                <button className="btn sm" onClick={submitPayee} disabled={!online || addPayee.isPending}>Add</button>
                <button className="btn sm" onClick={assignExisting} disabled={!online || applyMatch.isPending}
                  title="Give existing transactions without a payee the one their memo matches">Assign payees</button>
              </div>
              <div className="scroll-x">
                <table className="tbl tbl-fixed" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>Payee</th>
                      <th style={{ width: 320 }}>Matches memo</th>
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
                          <td className="ell"><Link className="name-link" to={txnsLink({ payee: p.id })}>{p.name}</Link></td>
                          <td>
                            <MatchInput value={p.match} disabled={!online}
                              onSave={match => run(updPayee, { id: p.id, match }, `Saved patterns for “${p.name}”`)} />
                          </td>
                          <td className="num" style={{ color: 'var(--ink2)' }}>{used}</td>
                          <td className="num" style={{ color: tt > 0 ? 'var(--inc)' : tt < 0 ? 'var(--out)' : 'var(--ink3)' }}>{fmt(tt, idx.disp)}</td>
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

/** Comma-separated memo patterns, saved on Enter or when the field loses focus; Escape undoes. */
function MatchInput({ value, disabled, onSave }: { value: string[]; disabled: boolean; onSave: (match: string[]) => void }) {
  const joined = value.join(', ');
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  const save = () => {
    const match = [...new Set(text.split(',').map(x => x.trim()).filter(Boolean))];
    if (match.join(', ') !== joined) onSave(match);
    else setText(joined);
  };
  return (
    <input className="input" style={{ width: '100%', height: 26, fontSize: 12 }} placeholder="e.g. Coffee Ghar" value={text} disabled={disabled}
      onChange={e => setText(e.target.value)} onBlur={save}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setText(joined); }} />
  );
}

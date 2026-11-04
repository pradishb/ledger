import { useState } from 'react';
import { useLedger } from '../data/context';
import { Bar, Dot, Header, Seg } from '../components/ui';
import { Donut, type Seg as DonutSeg } from '../components/Charts';
import { flows } from '../lib/ledger';
import { PERIODS, periodRange, rangeLabel, type Period } from '../lib/dates';
import { fmt } from '../lib/format';
import { OTHER, PALETTE, type CatType, type Category } from '../lib/types';

interface Row {
  key: string; name: string; color: string; amount: number; sub: boolean; chev: string; onClick?: () => void;
}

export function Stats() {
  const { data, idx, today } = useLedger();
  const [by, setBy] = useState<'cat' | 'payee'>('cat');
  const [type, setType] = useState<CatType>('exp');
  const [period, setPeriod] = useState<Period>('lm');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [from, to] = periodRange(period, today);
  const fl = flows(data.txns, from, to, idx).filter(f => idx.catType(f.cat) === type);
  const sg = type === 'exp' ? -1 : 1;
  const total = fl.reduce((a, f) => a + sg * f.amount, 0);
  const pct = (x: number) => (total > 0 ? ((x / total) * 100).toFixed(1) + '%' : '—');

  const rows: Row[] = [];
  let segs: DonutSeg[] = [];

  if (by === 'cat') {
    const agg = new Map<number, { c: Category; total: number; subs: Map<number, number> }>();
    for (const f of fl) {
      const tp = idx.topOf(f.cat);
      if (!tp) continue;
      const g = agg.get(tp.id) ?? { c: tp, total: 0, subs: new Map<number, number>() };
      agg.set(tp.id, g);
      g.total += sg * f.amount;
      g.subs.set(f.cat, (g.subs.get(f.cat) ?? 0) + sg * f.amount);
    }
    const list = [...agg.values()].filter(g => g.total !== 0).sort((a, b) => b.total - a.total);
    for (const g of list) {
      const color = g.c.color ?? OTHER;
      const hasSubs = [...g.subs.keys()].some(k => k !== g.c.id);
      const open = !!expanded[g.c.id];
      rows.push({
        key: `c${g.c.id}`, name: g.c.name, color, amount: g.total, sub: false,
        chev: hasSubs ? (open ? '▾' : '▸') : '',
        onClick: hasSubs ? () => setExpanded(p => ({ ...p, [g.c.id]: !p[g.c.id] })) : undefined,
      });
      if (open) {
        [...g.subs].sort((a, b) => b[1] - a[1]).forEach(([id, val]) => rows.push({
          key: `s${id}`, name: id === g.c.id ? '(no subcategory)' : idx.catMap.get(id)?.name ?? '?',
          color, amount: val, sub: true, chev: '',
        }));
      }
    }
    segs = list.filter(g => g.total > 0).map(g => ({ name: g.c.name, value: g.total, color: g.c.color ?? OTHER }));
  } else {
    const agg = new Map<number, number>();
    for (const f of fl) agg.set(f.payee, (agg.get(f.payee) ?? 0) + sg * f.amount);
    const list = [...agg].map(([id, val]) => ({ id, name: idx.payMap.get(id)?.name || '(no payee)', val }))
      .filter(x => x.val !== 0).sort((a, b) => b.val - a.val);
    list.forEach((x, i) => rows.push({ key: `p${x.id}`, name: x.name, color: i < 8 ? PALETTE[i] : OTHER, amount: x.val, sub: false, chev: '' }));
    segs = list.slice(0, 8).filter(x => x.val > 0).map((x, i) => ({ name: x.name, value: x.val, color: PALETTE[i] }));
    const rest = list.slice(8).reduce((a, x) => a + Math.max(0, x.val), 0);
    if (rest > 0) segs.push({ name: 'Other', value: rest, color: OTHER });
  }
  const mx = Math.max(1, ...rows.filter(r => !r.sub).map(r => r.amount));

  return (
    <>
      <Header title="Statistics" subtitle={PERIODS.find(p => p[0] === period)?.[1]} />
      <div className="content">
        <div className="stack">
          <div className="toolbar">
            <Seg value={by} onChange={setBy} options={[['cat', 'By category'], ['payee', 'By payee']] as const} />
            <Seg value={type} onChange={setType} options={[['exp', 'Expenses'], ['inc', 'Income']] as const} />
            <select className="select" value={period} onChange={e => setPeriod(e.target.value as Period)}>
              {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>{rangeLabel(from, to, today)}</span>
          </div>

          <div className="grid2">
            <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ position: 'relative', width: 220, height: 220 }}>
                <Donut segs={segs} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span className="muted" style={{ fontSize: 11.5 }}>{type === 'exp' ? 'Total spent' : 'Total received'}</span>
                  <span className="mono" style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.02em' }}>{fmt(total, idx.disp)}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>{fl.length} entries</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', width: '100%' }}>
                {segs.slice(0, 10).map(s => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--ink2)', minWidth: 0 }}>
                    <Dot color={s.color} /><span className="ell">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <table className="tbl fixed">
                <thead>
                  <tr>
                    <th>{by === 'cat' ? 'Category' : 'Payee'}</th>
                    <th style={{ width: '22%' }} />
                    <th className="r" style={{ width: 100 }}>Amount</th>
                    <th className="r" style={{ width: 64 }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.key} onClick={r.onClick} style={{ cursor: r.onClick ? 'pointer' : 'default', background: r.sub ? 'var(--sunk)' : undefined }}>
                      <td className="ell" style={{ paddingLeft: r.sub ? 30 : 10 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 10, color: 'var(--ink3)', fontSize: 10 }}>{r.chev}</span>
                          <Dot color={r.color} opacity={r.sub ? 0 : 1} />
                          <span style={{ fontWeight: r.sub ? 400 : 600, color: r.sub ? 'var(--ink2)' : 'var(--ink)', fontSize: r.sub ? 12.5 : 13 }}>{r.name}</span>
                        </span>
                      </td>
                      <td><Bar width={(Math.max(0, r.amount) / mx) * 100} color={r.color} opacity={r.sub ? 0.55 : 1} height={7} /></td>
                      <td className="num" style={{ color: r.sub ? 'var(--ink2)' : 'var(--ink)' }}>{fmt(r.amount, idx.disp)}</td>
                      <td className="num muted" style={{ fontSize: 11.5 }}>{pct(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && <div className="empty">Nothing recorded for this period.</div>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

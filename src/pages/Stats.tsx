import { useState, type CSSProperties } from 'react';
import { useLedger } from '../data/context';
import { Bar, Dot, Header, Panel, RangePicker, Seg, useRange } from '../components/common';
import { flows } from '../lib/ledger';
import { rangeDates, rangeName } from '../lib/dates';
import { fmt } from '../lib/format';
import { rankColor, type CatType, type Category } from '../lib/types';

interface Row {
  key: string; name: string; color: string; amount: number; sub: boolean; chev: string; onClick?: () => void;
}

export function Stats() {
  const { data, idx, today } = useLedger();
  const [by, setBy] = useState<'cat' | 'payee'>('cat');
  const [type, setType] = useState<CatType>('exp');
  const [period, setPeriod] = useRange('stats', 'lmonth');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const [from, to] = rangeDates(period, today);
  const fl = flows(data.txns, from, to, idx).filter(f => idx.catType(f.cat) === type);
  const sg = type === 'exp' ? -1 : 1;
  const total = fl.reduce((a, f) => a + sg * f.amount, 0);
  const pct = (x: number) => (total > 0 ? ((x / total) * 100).toFixed(1) + '%' : '—');

  const rows: Row[] = [];

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
    list.forEach((g, i) => {
      const color = rankColor(i);
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
    });
  } else {
    const agg = new Map<number, number>();
    for (const f of fl) agg.set(f.payee, (agg.get(f.payee) ?? 0) + sg * f.amount);
    const list = [...agg].map(([id, val]) => ({ id, name: idx.payMap.get(id)?.name || '(no payee)', val }))
      .filter(x => x.val !== 0).sort((a, b) => b.val - a.val);
    list.forEach((x, i) => rows.push({ key: `p${x.id}`, name: x.name, color: rankColor(i), amount: x.val, sub: false, chev: '' }));
  }
  const mx = Math.max(1, ...rows.filter(r => !r.sub).map(r => r.amount));
  // Size the amount column to the longest amount, so millions never run into the share.
  const amtW = Math.max(0, ...rows.map(r => fmt(r.amount, idx.disp).length));

  return (
    <>
      <Header title="Statistics" subtitle={rangeName(period)} />
      <div className="content">
        <div className="stack">
          <div className="toolbar">
            <Seg value={by} onChange={setBy} options={[['cat', 'By category'], ['payee', 'By payee']] as const} />
            <Seg value={type} onChange={setType} options={[['exp', 'Expenses'], ['inc', 'Income']] as const} />
            <RangePicker value={period} onChange={setPeriod} />
          </div>

          {/* One list, like the Overview's "Where your money goes": name, bar, amount, share. */}
          <div style={{ maxWidth: 920 }}>
            <Panel title={`${type === 'exp' ? 'Where your money goes' : 'Where your money comes from'} · ${by === 'cat' ? 'by category' : 'by payee'}`}
              action={<span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                {fl.length} entries
                <span className="font-mono text-[13px] font-medium" style={{ color: type === 'exp' ? 'var(--out)' : 'var(--inc)' }}>{fmt(total, idx.disp)}</span>
              </span>}>
              <div className="panel-body stats-list" style={{ '--amt-w': `${amtW + 1}ch` } as CSSProperties}>
                {rows.map(r => (
                  <div key={r.key} className={`spend-row${r.sub ? ' sub' : ''}${r.onClick ? ' clickable' : ''}`} onClick={r.onClick}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, paddingLeft: r.sub ? 26 : 0 }}>
                      <span style={{ width: 10, flex: 'none', color: 'var(--ink3)', fontSize: 10 }}>{r.chev}</span>
                      {!r.sub && <Dot color={r.color} />}
                      <span className="ell" style={{ fontWeight: r.sub ? 400 : 500, color: r.sub ? 'var(--ink2)' : 'var(--ink)' }}>{r.name}</span>
                    </div>
                    <Bar width={(Math.max(0, r.amount) / mx) * 100} color={r.color} opacity={r.sub ? 0.55 : 1} />
                    <div className="r mono" style={{ fontSize: 12, color: type === 'exp' ? 'var(--out)' : 'var(--inc)', opacity: r.sub ? 0.75 : 1 }}>{fmt(r.amount, idx.disp)}</div>
                    <div className="r mono muted" style={{ fontSize: 11.5 }}>{pct(r.amount)}</div>
                  </div>
                ))}
                {!rows.length && <div className="empty">Nothing recorded for this period.</div>}
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

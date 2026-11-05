import { useState, type CSSProperties } from 'react';
import { useLedger } from '../data/context';
import { useNavigate } from 'react-router';
import { Bar, Chevron, Dot, Header, Panel, RangePicker, Seg, useRange } from '../components/common';
import { txnsLink } from '../lib/links';
import { flows } from '../lib/ledger';
import { rangeDates, rangeName } from '../lib/dates';
import { fmt } from '../lib/format';
import { OTHER, rankColor, type CatType, type Category } from '../lib/types';

interface Row {
  key: string; name: string; color: string; amount: number; sub: boolean;
  /** Where clicking the row goes: its transactions for this period (none for "(no category)", which Transactions can't filter by). */
  href?: string;
  /** For a category with subcategories: whether they're shown, and how to toggle that. */
  open?: boolean; toggle?: () => void;
}

export function Stats() {
  const { data, idx, today } = useLedger();
  const navigate = useNavigate();
  const [by, setBy] = useState<'cat' | 'payee'>('cat');
  const [type, setType] = useState<CatType>('exp');
  const [period, setPeriod] = useRange('stats', 'lmonth');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  // Leave out entries without a category (By category) or payee (By payee), remembered per device.
  const [hideNone, setHideNone] = useState<Record<'cat' | 'payee', boolean>>(() => {
    try { return { cat: false, payee: false, ...JSON.parse(localStorage.getItem('ledger.stats.hideNone') ?? '{}') }; } catch { return { cat: false, payee: false }; }
  });
  const toggleHideNone = (v: boolean) => {
    const next = { ...hideNone, [by]: v };
    setHideNone(next);
    try { localStorage.setItem('ledger.stats.hideNone', JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  const [from, to] = rangeDates(period, today);
  const fl = flows(data.txns, from, to, idx).filter(f => idx.catType(f.cat) === type)
    .filter(f => !hideNone[by] || (by === 'cat' ? !!idx.topOf(f.cat) : !!idx.payMap.get(f.payee)));
  const sg = type === 'exp' ? -1 : 1;
  const total = fl.reduce((a, f) => a + sg * f.amount, 0);
  const pct = (x: number) => (total > 0 ? ((x / total) * 100).toFixed(1) + '%' : '—');

  const rows: Row[] = [];
  const link = (f: { category?: number; payee?: number; kind?: CatType }) => txnsLink({ ...f, from, to });

  if (by === 'cat') {
    const agg = new Map<number, { c: Category; total: number; subs: Map<number, number> }>();
    let none = 0;
    for (const f of fl) {
      const tp = idx.topOf(f.cat);
      if (!tp) { none += sg * f.amount; continue; }
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
        key: `c${g.c.id}`, name: g.c.name, color, amount: g.total, sub: false, href: link({ category: g.c.id }),
        open, toggle: hasSubs ? () => setExpanded(p => ({ ...p, [g.c.id]: !p[g.c.id] })) : undefined,
      });
      if (open) {
        [...g.subs].sort((a, b) => b[1] - a[1]).forEach(([id, val]) => rows.push({
          key: `s${id}`, name: id === g.c.id ? '(no subcategory)' : idx.catMap.get(id)?.name ?? '?',
          // "(no subcategory)" can only link to the parent, which includes its subcategories too.
          color, amount: val, sub: true, href: link({ category: id }),
        }));
      }
    });
    if (none !== 0) rows.push({ key: 'c0', name: '(no category)', color: OTHER, amount: none, sub: false });
  } else {
    const agg = new Map<number, number>();
    for (const f of fl) agg.set(f.payee, (agg.get(f.payee) ?? 0) + sg * f.amount);
    const list = [...agg].map(([id, val]) => ({ id, name: idx.payMap.get(id)?.name || '(no payee)', val }))
      .filter(x => x.val !== 0).sort((a, b) => b.val - a.val);
    list.forEach((x, i) => rows.push({ key: `p${x.id}`, name: x.name, color: rankColor(i), amount: x.val, sub: false, href: link({ payee: x.id, kind: type }) }));
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
            <label className="check-field" style={{ display: 'flex' }}>
              <input type="checkbox" checked={hideNone[by]} onChange={e => toggleHideNone(e.target.checked)} />
              Hide {by === 'cat' ? '(no category)' : '(no payee)'}
            </label>
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
                  <div key={r.key} className={`spend-row${r.href ? ' clickable' : ''}${r.sub ? ' sub' : ''}`}
                    onClick={r.href ? () => navigate(r.href!) : undefined} title={r.href ? `Show ${r.name} transactions` : undefined}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, paddingLeft: r.sub ? 26 : 0 }}>
                      {r.toggle ? (
                        <button type="button" className="expand" aria-expanded={r.open} aria-label={r.open ? 'Hide subcategories' : 'Show subcategories'}
                          onClick={e => { e.stopPropagation(); r.toggle!(); }}>
                          <Chevron open={!!r.open} />
                        </button>
                      ) : <span style={{ width: 18, flex: 'none' }} />}
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

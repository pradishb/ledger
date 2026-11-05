import { useState, type CSSProperties } from 'react';
import { useLedger } from '../data/context';
import { useNavigate } from 'react-router';
import { Bar, Chevron, Dot, Header, Panel, RangePicker, Seg, useRange, useUrlChoice, useUrlIds } from '../components/common';
import { txnsLink } from '../lib/links';
import { flows } from '../lib/ledger';
import { avgUnit, periodsIn, rangeDates, rangeName, UNITS, type Unit } from '../lib/dates';
import { fmt } from '../lib/format';
import { OTHER, rankColor, type CatType } from '../lib/types';

interface Row {
  key: string; name: string; color: string; amount: number; sub: boolean;
  /** How many transactions it's made of. */
  count: number;
  /** Where clicking the row goes: its transactions for this period (none for "(no category)", which Transactions can't filter by). */
  href?: string;
  /** For a category with subcategories: whether they're shown, and how to toggle that. */
  open?: boolean; toggle?: () => void;
}

export function Stats() {
  const { data, idx, today } = useLedger();
  const navigate = useNavigate();
  const [by, setBy] = useUrlChoice('by', ['cat', 'payee'] as const, 'cat');
  const [type, setType] = useUrlChoice<CatType>('type', ['exp', 'inc'], 'exp');
  const [period, setPeriod] = useRange('stats', 'lmonth');
  const [expanded, setExpanded] = useUrlIds('open');
  // Leave out entries without a category (By category) or payee (By payee), remembered per device.
  const [hideNone, setHideNone] = useState<Record<'cat' | 'payee', boolean>>(() => {
    try { return { cat: false, payee: false, ...JSON.parse(localStorage.getItem('ledger.stats.hideNone') ?? '{}') }; } catch { return { cat: false, payee: false }; }
  });
  const toggleHideNone = (v: boolean) => {
    const next = { ...hideNone, [by]: v };
    setHideNone(next);
    try { localStorage.setItem('ledger.stats.hideNone', JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  const [avgPick, setAvgPick] = useAvgUnit();

  const [from, to] = rangeDates(period, today);
  // Averages are over the part of the range that has happened: open-ended ranges start at the first
  // transaction, and days after today (or the last transaction, if later) aren't counted.
  let first = today, last = today;
  for (const t of data.txns) { if (t.date < first) first = t.date; if (t.date > last) last = t.date; }
  let aFrom = from < first ? first : from, aTo = to > last ? last : to;
  if (aFrom > aTo) [aFrom, aTo] = [from, to];
  const unit: Unit = avgPick === 'auto' ? avgUnit(aFrom, aTo) : avgPick;
  const periods = periodsIn(aFrom, aTo, unit);
  const avg = (x: number) => (periods > 0 ? Math.round(x / periods) : 0);
  const fl = flows(data.txns, from, to, idx).filter(f => idx.catType(f.cat) === type)
    .filter(f => !hideNone[by] || (by === 'cat' ? !!idx.topOf(f.cat) : !!idx.payMap.get(f.payee)));
  const sg = type === 'exp' ? -1 : 1;
  const total = fl.reduce((a, f) => a + sg * f.amount, 0);
  const pct = (x: number) => (total > 0 ? ((x / total) * 100).toFixed(1) + '%' : '—');

  const rows: Row[] = [];
  const link = (f: { category?: number; payee?: number; kind?: CatType }) => txnsLink({ ...f, from, to });

  // An amount and the transactions it came from (a split counts once per row it adds to).
  type Sum = { amount: number; ids: Set<number> };
  const sum = (): Sum => ({ amount: 0, ids: new Set() });
  const add = (m: Map<number, Sum>, k: number, f: { id: number; amount: number }) => {
    const s = m.get(k) ?? sum();
    m.set(k, s);
    s.amount += sg * f.amount;
    s.ids.add(f.id);
  };

  if (by === 'cat') {
    const agg = new Map<number, Sum>();
    const subs = new Map<number, Map<number, Sum>>();
    const none = sum();
    for (const f of fl) {
      const tp = idx.topOf(f.cat);
      if (!tp) { none.amount += sg * f.amount; none.ids.add(f.id); continue; }
      add(agg, tp.id, f);
      if (!subs.has(tp.id)) subs.set(tp.id, new Map());
      add(subs.get(tp.id)!, f.cat, f);
    }
    const list = [...agg].filter(([, g]) => g.amount !== 0).sort((a, b) => b[1].amount - a[1].amount);
    list.forEach(([cid, g], i) => {
      const color = rankColor(i);
      const gs = subs.get(cid)!;
      const hasSubs = [...gs.keys()].some(k => k !== cid);
      const open = !!expanded[cid];
      rows.push({
        key: `c${cid}`, name: idx.catMap.get(cid)?.name ?? '?', color, amount: g.amount, count: g.ids.size, sub: false, href: link({ category: cid }),
        open, toggle: hasSubs ? () => setExpanded(p => ({ ...p, [cid]: !p[cid] })) : undefined,
      });
      if (open) {
        [...gs].sort((a, b) => b[1].amount - a[1].amount).forEach(([id, v]) => rows.push({
          key: `s${id}`, name: id === cid ? '(no subcategory)' : idx.catMap.get(id)?.name ?? '?',
          // "(no subcategory)" can only link to the parent, which includes its subcategories too.
          color, amount: v.amount, count: v.ids.size, sub: true, href: link({ category: id }),
        }));
      }
    });
    if (none.amount !== 0) rows.push({ key: 'c0', name: '(no category)', color: OTHER, amount: none.amount, count: none.ids.size, sub: false });
  } else {
    const agg = new Map<number, Sum>();
    for (const f of fl) add(agg, f.payee, f);
    const list = [...agg].map(([id, v]) => ({ id, name: idx.payMap.get(id)?.name || '(no payee)', v }))
      .filter(x => x.v.amount !== 0).sort((a, b) => b.v.amount - a.v.amount);
    list.forEach((x, i) => rows.push({
      key: `p${x.id}`, name: x.name, color: rankColor(i), amount: x.v.amount, count: x.v.ids.size, sub: false, href: link({ payee: x.id, kind: type }),
    }));
  }
  const mx = Math.max(1, ...rows.filter(r => !r.sub).map(r => r.amount));
  // Size the amount column to the longest amount, so millions never run into the share.
  const amtW = Math.max(0, ...rows.map(r => fmt(r.amount, idx.disp).length));
  const cntW = Math.max(1, ...rows.map(r => String(r.count).length));
  const avgW = Math.max(0, ...rows.map(r => fmt(avg(r.amount), idx.disp).length));
  const txnCount = new Set(fl.map(f => f.id)).size;

  return (
    <>
      <Header title="Statistics" subtitle={rangeName(period)} />
      <div className="content">
        <div className="stack">
          <div className="toolbar">
            <Seg value={by} onChange={setBy} options={[['cat', 'By category'], ['payee', 'By payee']] as const} />
            <Seg value={type} onChange={setType} options={[['exp', 'Expenses'], ['inc', 'Income']] as const} />
            <RangePicker value={period} onChange={setPeriod} />
            <select className="select" value={avgPick} onChange={e => setAvgPick(e.target.value as Unit | 'auto')} aria-label="Average per"
              title="The average column: the amount per day, week, month… over this range">
              <option value="auto">Average per {UNIT_NOUN[avgUnit(aFrom, aTo)]} (auto)</option>
              {UNITS.map(u => <option key={u} value={u}>Average per {UNIT_NOUN[u]}</option>)}
            </select>
            <label className="check-field" style={{ display: 'flex' }}>
              <input type="checkbox" checked={hideNone[by]} onChange={e => toggleHideNone(e.target.checked)} />
              Hide {by === 'cat' ? '(no category)' : '(no payee)'}
            </label>
          </div>

          {/* One list, like the Overview's Spendings: name, bar, amount, share. */}
          <div style={{ maxWidth: 920 }}>
            <Panel title={`${type === 'exp' ? 'Spendings' : 'Income'} · ${by === 'cat' ? 'by category' : 'by payee'}`}
              action={<span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                {txnCount} transaction{txnCount === 1 ? '' : 's'}
                <span className="font-mono text-[13px] font-medium" style={{ color: type === 'exp' ? 'var(--out)' : 'var(--inc)' }}>{fmt(total, idx.disp)}</span>
                <span className="font-mono" title={`Average per ${UNIT_NOUN[unit]}`}>{fmt(avg(total), idx.disp)}/{UNIT_SHORT[unit]}</span>
              </span>}>
              <div className="panel-body stats-list" style={{ '--amt-w': `${amtW + 1}ch`, '--cnt-w': `${cntW + 1}ch`, '--avg-w': `${avgW + 1}ch` } as CSSProperties}>
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
                    <div className="r mono muted" style={{ fontSize: 11.5, opacity: r.sub ? 0.75 : 1 }} title={`${r.count} transaction${r.count === 1 ? '' : 's'}`}>{r.count}</div>
                    <div className="r mono" style={{ fontSize: 12, color: type === 'exp' ? 'var(--out)' : 'var(--inc)', opacity: r.sub ? 0.75 : 1 }}>{fmt(r.amount, idx.disp)}</div>
                    <div className="r mono muted" style={{ fontSize: 11.5, opacity: r.sub ? 0.75 : 1 }} title={`Average per ${UNIT_NOUN[unit]}`}>{fmt(avg(r.amount), idx.disp)}</div>
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

const UNIT_NOUN: Record<Unit, string> = { day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year' };
const UNIT_SHORT: Record<Unit, string> = { day: 'day', week: 'wk', month: 'mo', quarter: 'qtr', year: 'yr' };

/** The unit for the average column, or 'auto' to suit the range; remembered per device. */
function useAvgUnit() {
  const key = 'ledger.stats.avg';
  const [u, setU] = useState<Unit | 'auto'>(() => {
    try { const v = localStorage.getItem(key) as Unit; return UNITS.includes(v) ? v : 'auto'; } catch { return 'auto'; }
  });
  const set = (v: Unit | 'auto') => {
    setU(v);
    try { localStorage.setItem(key, v); } catch { /* storage unavailable */ }
  };
  return [u, set] as const;
}

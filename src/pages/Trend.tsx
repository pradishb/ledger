import { useState, type MouseEvent, type ReactNode } from 'react';
import { useLedger } from '../data/context';
import { Dot, Header, Panel, RangePicker, Seg, useRange, useUrlChoice, useUrlIds } from '../components/common';
import { ChartBars, ChartIE, ChartLine, ChartStack, Sized, SizedBox, type Series } from '../components/Charts';
import { balColor, flows, sumType } from '../lib/ledger';
import { addDays, buckets, rangeDates, rangeLabel, unitFits, UNIT_NAME, type Unit } from '../lib/dates';
import { fmt0 } from '../lib/format';
import { OTHER } from '../lib/types';

interface Cell { v: string; color: string }
interface Row { name: string; color: string; cells: Cell[]; total: string; avg: string; totColor: string; weight: number; op: number; onClick?: (e: MouseEvent) => void }

export function Trend() {
  const { data, idx, today } = useLedger();
  const [mode, setMode] = useUrlChoice('mode', ['ie', 'cat', 'nw'] as const, 'ie');
  const [range, setRange] = useRange('trend', 'l12m');
  const [unit, setUnit] = useTrendUnit();
  const [hidden, setHidden] = useUrlIds('hide');

  // The chosen range, trimmed to where the transactions are (for open-ended ranges like All dates),
  // split into one column per period.
  const [rFrom, rTo] = rangeDates(range, today);
  let first = today, last = today;
  for (const t of data.txns) { if (t.date < first) first = t.date; if (t.date > last) last = t.date; }
  let cFrom = rFrom < first ? first : rFrom, cTo = rTo > last ? last : rTo;
  if (cFrom > cTo) [cFrom, cTo] = [rFrom, rTo];
  const fits = (u: Unit) => unitFits(cFrom, cTo, u) && buckets(cFrom, cTo, u).list.length <= MAX_COLS;
  // A period too small for the range (weekly over ten years) steps up to the next one that fits.
  const shownUnit = PERIODS.find(u => PERIODS.indexOf(u) >= PERIODS.indexOf(unit) && fits(u)) ?? 'year';
  const months = buckets(cFrom, cTo, shownUnit).list;
  const N = months.length;
  const per = UNIT_NOUN[shownUnit];
  const mfl = months.map(m => flows(data.txns, m.from, m.to, idx));
  const T = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const cell = (c: number, color = 'var(--ink)'): Cell => ({ v: Math.abs(c) < 50 ? '–' : fmt0(c, idx.disp), color });

  let rows: Row[];
  let legend: { key: string; name: string; color: string; op: number; onClick?: (e: MouseEvent) => void }[];
  let chart: (w: number) => ReactNode;
  let nwView: ReactNode = null;
  // Income vs expenses: a second chart of the net (income minus expenses) each period.
  let savedPanel: ReactNode = null;

  if (mode === 'ie') {
    const inc = mfl.map(f => sumType(f, 'inc', idx)), exp = mfl.map(f => sumType(f, 'exp', idx));
    const net = inc.map((x, i) => x - exp[i]);
    chart = w => <ChartIE months={months.map((m, i) => ({ ...m, inc: inc[i], exp: exp[i] }))} w={w} h={220} />;
    legend = [{ key: 'i', name: 'Income', color: 'var(--acc)', op: 1 }, { key: 'e', name: 'Expenses', color: 'var(--exp)', op: 1 }];
    const rate = T(inc) ? Math.round((T(net) / T(inc)) * 100) : null;
    savedPanel = (
      <Panel title="Net" action={
        <span className="text-xs text-muted-foreground">
          <b className="font-mono text-[13px] font-medium" style={{ color: balColor(T(net)) }}>{fmt0(T(net), idx.disp)}</b>
          {rate !== null && ` · ${rate}% of income`}
        </span>
      }>
        <div style={{ padding: '14px 12px 8px' }}>
          <Sized>{w => <ChartBars months={months} values={net} name="Net" w={w} h={180}
            pct={i => (inc[i] > 0 ? ` · ${Math.round((net[i] / inc[i]) * 100)}% of income` : '')} />}</Sized>
        </div>
      </Panel>
    );
    rows = [
      { name: 'Income', color: 'var(--acc)', cells: inc.map(x => cell(x, 'var(--inc)')), total: fmt0(T(inc), idx.disp), avg: fmt0(T(inc) / N, idx.disp), totColor: 'var(--inc)', weight: 400, op: 1 },
      { name: 'Expenses', color: 'var(--exp)', cells: exp.map(x => cell(x, 'var(--out)')), total: fmt0(T(exp), idx.disp), avg: fmt0(T(exp) / N, idx.disp), totColor: 'var(--out)', weight: 400, op: 1 },
      { name: 'Net', color: 'transparent', cells: net.map(x => cell(x, balColor(x))), total: fmt0(T(net), idx.disp), avg: fmt0(T(net) / N, idx.disp), totColor: balColor(T(net)), weight: 600, op: 1 },
      {
        name: 'Savings rate', color: 'transparent',
        cells: net.map((x, i) => ({ v: inc[i] ? Math.round((x / inc[i]) * 100) + '%' : '–', color: 'var(--ink2)' })),
        total: T(inc) ? Math.round((T(net) / T(inc)) * 100) + '%' : '–', avg: '', totColor: 'var(--ink2)', weight: 400, op: 1,
      },
    ];
  } else if (mode === 'nw') {
    // Balances at the end of each period (today at the latest, like the Overview), from the opening
    // balances and every transaction up to then, converted at today's rates. Hidden accounts count.
    const txns = [...data.txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const accBal = new Map(data.accounts.map(a => [a.id, a.opening]));
    const apply = (id: number, amt: number) => { if (accBal.has(id)) accBal.set(id, accBal.get(id)! + amt); };
    let k = 0;
    const at = (date: string) => {
      for (; k < txns.length && txns[k].date <= date; k++) {
        const t = txns[k];
        apply(t.acc, t.amount);
        if (t.xfer) apply(t.xfer, t.xamt ?? -t.amount);
      }
      let assets = 0, owed = 0;
      for (const a of data.accounts) {
        const v = idx.toDisp(a.id, accBal.get(a.id) ?? 0);
        if (v >= 0) assets += v; else owed -= v;
      }
      return { assets, owed, net: assets - owed };
    };
    const start = at(addDays(months[0].from, -1));
    const ends = months.map(m => at(m.to < today ? m.to : today));
    const assets = ends.map(e => e.assets), owed = ends.map(e => e.owed), net = ends.map(e => e.net);
    const change = net.map((x, i) => x - (i ? net[i - 1] : start.net));
    const total = net[N - 1] - start.net;
    const money = (x: number, color: string, weight = 400) => (
      <td className="num" style={{ fontSize: 12, color, fontWeight: weight }}>{fmt0(x, idx.disp)}</td>
    );
    chart = () => null; legend = []; rows = [];
    // Chart on the left at full height; the periods, newest first, on the right.
    nwView = (
      <div className="nw-split">
        <Panel title="Net worth" action={<span className="font-mono text-[13px] font-medium" style={{ color: balColor(net[N - 1]) }}>{fmt0(net[N - 1], idx.disp)}</span>}>
          <SizedBox style={{ minHeight: 260, padding: '8px 12px 8px' }}>
            {(w, h) => <ChartLine months={months} values={net} name="Net worth" w={w} h={h} />}
          </SizedBox>
        </Panel>
        <div className="panel nw-table">
          <table className="tbl">
            <thead>
              <tr>
                <th>{per[0].toUpperCase() + per.slice(1)}</th>
                <th className="r">Assets</th>
                <th className="r">Owed</th>
                <th className="r">Net worth</th>
                <th className="r" title={`Change from the ${per} before`}>Change</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => ({ m, i })).reverse().map(({ m, i }) => (
                <tr key={m.key}>
                  <td style={{ whiteSpace: 'nowrap' }}>{m.full}</td>
                  {money(assets[i], 'var(--inc)')}
                  {money(owed[i], 'var(--out)')}
                  {money(net[i], balColor(net[i]), 600)}
                  {money(change[i], balColor(change[i]))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 600 }}>Over the range</td>
                {money(assets[N - 1] - start.assets, 'var(--ink2)')}
                {money(owed[N - 1] - start.owed, 'var(--ink2)')}
                {money(total, balColor(total), 600)}
                <td className="num muted" style={{ fontSize: 11.5 }} title={`Average change per ${per}`}>{fmt0(total / N, idx.disp)}/{per}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  } else {
    const series: Series[] = idx.tops.filter(c => c.type === 'exp').map(c => ({
      id: c.id, name: c.name, color: c.color ?? OTHER,
      values: mfl.map(fl => fl.reduce((a, f) => (idx.topOf(f.cat)?.id === c.id ? a - f.amount : a), 0)),
    })).filter(x => x.values.some(y => y !== 0));
    const shown = series.filter(x => !hidden[x.id]);
    // Click: show only this category (or, if it's already the only one, show them all again).
    // Ctrl/Cmd/Shift-click: add or remove just this one.
    const pick = (id: number) => (e: MouseEvent) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) return setHidden(h => ({ ...h, [id]: !h[id] }));
      const alone = shown.length === 1 && shown[0].id === id;
      setHidden(alone ? {} : Object.fromEntries(series.filter(x => x.id !== id).map(x => [x.id, true])));
    };
    chart = w => <ChartStack months={months} series={shown} w={w} h={220} />;
    legend = series.map(x => ({ key: String(x.id), name: x.name, color: x.color, op: hidden[x.id] ? 0.4 : 1, onClick: pick(x.id) }));
    if (shown.length < series.length) legend.unshift({ key: 'all', name: 'Show all', color: 'transparent', op: 1, onClick: () => setHidden({}) });
    rows = series.map(x => ({
      name: x.name, color: x.color, cells: x.values.map(y => cell(y)), total: fmt0(T(x.values), idx.disp), avg: fmt0(T(x.values) / N, idx.disp),
      totColor: 'var(--ink)', weight: 400, op: hidden[x.id] ? 0.4 : 1, onClick: pick(x.id),
    }));
    const tot = months.map((_, i) => shown.reduce((a, x) => a + x.values[i], 0));
    rows.push({ name: 'Total shown', color: 'transparent', cells: tot.map(y => cell(y)), total: fmt0(T(tot), idx.disp), avg: fmt0(T(tot) / N, idx.disp), totColor: 'var(--ink)', weight: 600, op: 1 });
  }

  const sticky = { position: 'sticky' as const, left: 0, background: 'var(--panel)' };

  return (
    <>
      <Header title="Trend over time" subtitle={mode === 'nw' ? `${UNIT_NAME[shownUnit]}, balance at each period's end` : `${UNIT_NAME[shownUnit]}, transfers excluded`} />
      <div className="content">
        <div className={`stack${mode === 'nw' ? ' dash' : ''}`}>
          <div className="toolbar">
            <Seg value={mode} onChange={setMode} options={[['ie', 'Income vs expenses'], ['cat', 'Spending by category'], ['nw', 'Net worth']] as const} />
            <RangePicker value={range} onChange={setRange} />
            <select className="select" value={shownUnit} onChange={e => setUnit(e.target.value as Unit)} aria-label="One column per">
              {PERIODS.map(u => <option key={u} value={u} disabled={!fits(u)}>{UNIT_NAME[u]}</option>)}
            </select>
            {(cFrom !== rFrom || cTo !== rTo) && <span className="muted" style={{ fontSize: 12 }}>Data: {rangeLabel(cFrom, cTo, today)}</span>}
          </div>

          {nwView ?? <>
          <div className="panel">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
              {legend.map(l => (
                <button key={l.key} className={`chip${l.key === 'all' ? ' chip-all' : ''}`} onClick={l.onClick} style={{ opacity: l.op, cursor: l.onClick ? 'pointer' : 'default' }}
                  title={mode === 'cat' && l.key !== 'all' ? 'Click to show only this · Ctrl-click to add or remove' : undefined}>
                  {l.key !== 'all' && <Dot color={l.color} />}{l.name}
                </button>
              ))}
              {mode === 'cat' && <span className="muted" style={{ fontSize: 11.5, alignSelf: 'center', marginLeft: 4 }}>Click a category to show only it · Ctrl-click to add or remove</span>}
            </div>
            <div style={{ padding: '14px 12px 8px' }}><Sized>{chart}</Sized></div>
          </div>

          {savedPanel}

          <div className="panel scroll-x">
            <table className="tbl" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={sticky} />
                  {months.map(m => (
                    <th key={m.key} className="r" style={{ whiteSpace: 'nowrap' }} title={m.full}>{m.label}</th>
                  ))}
                  <th className="r" style={{ fontWeight: 600, color: 'var(--ink2)', borderLeft: '1px solid var(--line)' }}>Total</th>
                  <th className="r" style={{ fontWeight: 600, color: 'var(--ink2)' }}>Avg / {per}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.name} style={{ opacity: r.op, cursor: r.onClick ? 'pointer' : undefined }} onClick={r.onClick}>
                    <td style={{ ...sticky, whiteSpace: 'nowrap', fontWeight: r.weight }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Dot color={r.color} />{r.name}</span>
                    </td>
                    {r.cells.map((c, i) => (
                      <td key={i} className="num" style={{ fontSize: 11.5, color: c.color, fontWeight: r.weight }}>{c.v}</td>
                    ))}
                    <td className="num" style={{ fontSize: 11.5, fontWeight: 600, color: r.totColor, borderLeft: '1px solid var(--line)' }}>{r.total}</td>
                    <td className="num" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{r.avg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>}
        </div>
      </div>
    </>
  );
}

/** Column sizes that make sense for a table (daily would be hundreds of columns). */
const PERIODS: Unit[] = ['week', 'month', 'quarter', 'year'];
const UNIT_NOUN: Record<Unit, string> = { day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year' };
/** Past this many columns the table and chart get unreadable. */
const MAX_COLS = 120;
const UNIT_KEY = 'ledger.unit.trend';

/** Trend's period size, remembered per device. Monthly to start. */
function useTrendUnit() {
  const [u, setU] = useState<Unit>(() => {
    try { const v = localStorage.getItem(UNIT_KEY) as Unit; return PERIODS.includes(v) ? v : 'month'; } catch { return 'month'; }
  });
  const set = (v: Unit) => {
    setU(v);
    try { localStorage.setItem(UNIT_KEY, v); } catch { /* storage unavailable */ }
  };
  return [u, set] as const;
}

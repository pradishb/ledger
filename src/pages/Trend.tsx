import { useState, type ReactNode } from 'react';
import { useLedger } from '../data/context';
import { Dot, Header, Seg } from '../components/ui';
import { ChartIE, ChartStack, Sized, type Series } from '../components/Charts';
import { balColor, flows, sumType } from '../lib/ledger';
import { monthsBack } from '../lib/dates';
import { fmt0 } from '../lib/format';
import { OTHER } from '../lib/types';

interface Cell { v: string; color: string }
interface Row { name: string; color: string; cells: Cell[]; total: string; avg: string; totColor: string; weight: number; op: number }

export function Trend() {
  const { data, idx, today } = useLedger();
  const [mode, setMode] = useState<'ie' | 'cat'>('ie');
  const [n, setN] = useState<'6' | '12'>('12');
  const [hidden, setHidden] = useState<Record<number, boolean>>({});

  const N = Number(n);
  const months = monthsBack(N, today);
  const mfl = months.map(m => flows(data.txns, m.from, m.to, idx));
  const T = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const cell = (c: number, color = 'var(--ink)'): Cell => ({ v: Math.abs(c) < 50 ? '–' : fmt0(c, idx.disp), color });

  let rows: Row[];
  let legend: { key: string; name: string; color: string; op: number; onClick?: () => void }[];
  let chart: (w: number) => ReactNode;

  if (mode === 'ie') {
    const inc = mfl.map(f => sumType(f, 'inc', idx)), exp = mfl.map(f => sumType(f, 'exp', idx));
    const net = inc.map((x, i) => x - exp[i]);
    chart = w => <ChartIE months={months.map((m, i) => ({ ...m, inc: inc[i], exp: exp[i] }))} w={w} h={220} />;
    legend = [{ key: 'i', name: 'Income', color: 'var(--acc)', op: 1 }, { key: 'e', name: 'Expenses', color: 'var(--exp)', op: 1 }];
    rows = [
      { name: 'Income', color: 'var(--acc)', cells: inc.map(x => cell(x, 'var(--pos)')), total: fmt0(T(inc), idx.disp), avg: fmt0(T(inc) / N, idx.disp), totColor: 'var(--pos)', weight: 400, op: 1 },
      { name: 'Expenses', color: 'var(--exp)', cells: exp.map(x => cell(x)), total: fmt0(T(exp), idx.disp), avg: fmt0(T(exp) / N, idx.disp), totColor: 'var(--ink)', weight: 400, op: 1 },
      { name: 'Net', color: 'transparent', cells: net.map(x => cell(x, balColor(x))), total: fmt0(T(net), idx.disp), avg: fmt0(T(net) / N, idx.disp), totColor: balColor(T(net)), weight: 600, op: 1 },
      {
        name: 'Savings rate', color: 'transparent',
        cells: net.map((x, i) => ({ v: inc[i] ? Math.round((x / inc[i]) * 100) + '%' : '–', color: 'var(--ink2)' })),
        total: T(inc) ? Math.round((T(net) / T(inc)) * 100) + '%' : '–', avg: '', totColor: 'var(--ink2)', weight: 400, op: 1,
      },
    ];
  } else {
    const series: Series[] = idx.tops.filter(c => c.type === 'exp').map(c => ({
      id: c.id, name: c.name, color: c.color ?? OTHER,
      values: mfl.map(fl => fl.reduce((a, f) => (idx.topOf(f.cat)?.id === c.id ? a - f.amount : a), 0)),
    })).filter(x => x.values.some(y => y !== 0));
    const shown = series.filter(x => !hidden[x.id]);
    chart = w => <ChartStack months={months} series={shown} w={w} h={220} />;
    legend = series.map(x => ({
      key: String(x.id), name: x.name, color: x.color, op: hidden[x.id] ? 0.4 : 1,
      onClick: () => setHidden(h => ({ ...h, [x.id]: !h[x.id] })),
    }));
    rows = series.map(x => ({
      name: x.name, color: x.color, cells: x.values.map(y => cell(y)), total: fmt0(T(x.values), idx.disp), avg: fmt0(T(x.values) / N, idx.disp),
      totColor: 'var(--ink)', weight: 400, op: hidden[x.id] ? 0.4 : 1,
    }));
    const tot = months.map((_, i) => shown.reduce((a, x) => a + x.values[i], 0));
    rows.push({ name: 'Total shown', color: 'transparent', cells: tot.map(y => cell(y)), total: fmt0(T(tot), idx.disp), avg: fmt0(T(tot) / N, idx.disp), totColor: 'var(--ink)', weight: 600, op: 1 });
  }

  const sticky = { position: 'sticky' as const, left: 0, background: 'var(--panel)' };

  return (
    <>
      <Header title="Trend over time" subtitle="Monthly, transfers excluded" />
      <div className="content">
        <div className="stack">
          <div className="toolbar">
            <Seg value={mode} onChange={setMode} options={[['ie', 'Income vs expenses'], ['cat', 'Spending by category']] as const} />
            <Seg value={n} onChange={setN} options={[['6', '6 months'], ['12', '12 months']] as const} />
            <span className="muted" style={{ fontSize: 12 }}>{months[0].full} – {months[months.length - 1].full}</span>
          </div>

          <div className="panel">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
              {legend.map(l => (
                <button key={l.key} className="chip" onClick={l.onClick} style={{ opacity: l.op, cursor: l.onClick ? 'pointer' : 'default' }}>
                  <Dot color={l.color} />{l.name}
                </button>
              ))}
            </div>
            <div style={{ padding: '14px 12px 8px' }}><Sized>{chart}</Sized></div>
          </div>

          <div className="panel scroll-x">
            <table className="tbl" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={sticky} />
                  {months.map((m, i) => (
                    <th key={m.key} className="r" style={{ whiteSpace: 'nowrap' }}>
                      {m.label}{m.key.endsWith('-01') || i === 0 ? ` '${m.key.slice(2, 4)}` : ''}
                    </th>
                  ))}
                  <th className="r" style={{ fontWeight: 600, color: 'var(--ink2)', borderLeft: '1px solid var(--line)' }}>Total</th>
                  <th className="r" style={{ fontWeight: 600, color: 'var(--ink2)' }}>Avg / mo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.name} style={{ opacity: r.op }}>
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
        </div>
      </div>
    </>
  );
}

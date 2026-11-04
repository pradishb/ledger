import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useLedger } from '../data/context';
import { api, useLedgerMutation } from '../data/api';
import { Bar, Chevron, DisplayCurrency, Dot, Header, Panel, RangePicker, useOpenGroups, useRange } from '../components/ui';
import { ChartIE, SizedBox } from '../components/Charts';
import { accountGroups, balColor, flows, sumType } from '../lib/ledger';
import { autoUnit, buckets, longDate, rangeDates, rangeName, unitFits, UNIT_NAME, UNITS, type Unit } from '../lib/dates';
import { errorMessage, fmt, fmt0 } from '../lib/format';
import { rankColor } from '../lib/types';

export function Overview() {
  const { data, idx, bal, today, netWorth, online, toast } = useLedger();
  const navigate = useNavigate();
  const { isOpen, toggle } = useOpenGroups();
  const seed = useLedgerMutation(api.seedCategories);

  const [range, setRange] = useRange('overview', 'l30');
  const [rFrom, rTo] = rangeDates(range, today);
  const rl = rangeName(range);
  const fl30 = flows(data.txns, rFrom, rTo, idx);
  const inc = sumType(fl30, 'inc', idx), exp = sumType(fl30, 'exp', idx);
  const assets = data.accounts.reduce((a, x) => a + Math.max(0, idx.toDisp(x.id, bal.get(x.id) ?? 0)), 0);

  const kpis = [
    { label: 'Net worth', value: fmt(netWorth, idx.disp), sub: idx.unrated.length
      ? `${idx.unrated.join(', ')} left out: no exchange rate`
      : `${fmt0(assets, idx.disp)} assets · ${fmt0(assets - netWorth, idx.disp)} owed`, color: 'var(--ink)' },
    { label: `Income · ${rl}`, value: fmt(inc, idx.disp), sub: 'Transfers excluded', color: 'var(--pos)' },
    { label: `Spending · ${rl}`, value: fmt(exp, idx.disp), sub: `${fl30.filter(f => idx.catType(f.cat) === 'exp').length} entries`, color: 'var(--ink)' },
    { label: `Saved · ${rl}`, value: fmt(inc - exp, idx.disp), sub: inc ? `${Math.round(((inc - exp) / inc) * 100)}% of income` : '—', color: balColor(inc - exp) },
  ];

  // Each panel has its own range; new ones start from the cards' range.
  const [sRange, setSRange] = useRange('overview.spend', range);
  const [sFrom, sTo] = rangeDates(sRange, today);
  const sFl = flows(data.txns, sFrom, sTo, idx);
  const sExp = sumType(sFl, 'exp', idx);
  const byTop = new Map<number, number>();
  for (const f of sFl) {
    if (idx.catType(f.cat) !== 'exp') continue;
    const tp = idx.topOf(f.cat);
    if (tp) byTop.set(tp.id, (byTop.get(tp.id) ?? 0) - f.amount);
  }
  const spend = [...byTop].map(([id, val]) => ({ c: idx.catMap.get(id)!, val })).filter(x => x.val > 0).sort((a, b) => b.val - a.val);
  const spendMax = spend[0]?.val || 1;

  // Chart its own range, by the chosen unit; open-ended ranges stop where the transactions do.
  const [cRange, setCRange] = useRange('overview.chart', range);
  const [unit, setUnit] = useUnit();
  const [crFrom, crTo] = rangeDates(cRange, today);
  let first = today, last = today;
  for (const t of data.txns) { if (t.date < first) first = t.date; if (t.date > last) last = t.date; }
  let cFrom = crFrom < first ? first : crFrom, cTo = crTo > last ? last : crTo;
  if (cFrom > cTo) [cFrom, cTo] = [crFrom, crTo];
  const chart = buckets(cFrom, cTo, unit === 'auto' ? undefined : unit);
  // A unit too fine for the range (say daily over ten years) falls back to auto; show that.
  const shownUnit = unit !== 'auto' && unitFits(cFrom, cTo, unit) ? unit : 'auto';
  const months = chart.list.map(m => {
    const fl = flows(data.txns, m.from, m.to, idx);
    return { ...m, inc: sumType(fl, 'inc', idx), exp: sumType(fl, 'exp', idx) };
  });

  const groupRows = (list: typeof data.accounts) => list.map(a => {
    const b = bal.get(a.id) ?? 0;
    return (
      <tr className="clickable" key={a.id} onClick={() => navigate(`/accounts/${a.id}`)}>
        <td style={{ paddingLeft: 28 }}>{a.name}</td>
        <td className="num" style={{ color: balColor(b) }}>{fmt(b, idx.accCur(a.id))}</td>
      </tr>
    );
  });

  const needsSetup = !data.accounts.length || !data.cats.length;

  return (
    <>
      <Header title="Overview" subtitle={longDate(today)}><DisplayCurrency /></Header>
      <div className="content">
        <div className="stack dash">
          {needsSetup && (
            <div className="panel onboard">
              <b>Welcome to Ledger</b>
              {!data.cats.length && (
                <>
                  <p>Start with a standard set of income and expense categories. You can rename or delete them later.</p>
                  <button className="btn-primary" disabled={seed.isPending || !online}
                    onClick={() => seed.mutate(undefined, { onSuccess: () => toast('Starter categories added'), onError: e => toast(errorMessage(e)) })}>
                    Add starter categories
                  </button>
                </>
              )}
              {!data.accounts.length && (
                <>
                  <p>Add your bank accounts, cards and cash with their opening balances.</p>
                  <Link className="btn" to="/accounts" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Add an account</Link>
                </>
              )}
            </div>
          )}

          <div className="toolbar"><RangePicker value={range} onChange={setRange} /></div>

          <div className="kpis">
            {kpis.map(k => (
              <div className="kpi" key={k.label}>
                <div className="l">{k.label}</div>
                <div className="v" style={{ color: k.color }}>{k.value}</div>
                <div className="s">{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="dash3">
            <Panel title="Accounts" action={<Link className="link" to="/accounts">All accounts</Link>}>
              <div className="panel-body">
              <table className="tbl">
                <tbody>
                  {accountGroups(data.accounts, bal, idx).map(g => [
                    <tr className="group toggle" key={g.label} onClick={() => toggle(g.label)} aria-expanded={isOpen(g.label)}>
                      <td style={{ fontWeight: 600, color: 'var(--ink2)', fontSize: 11.5 }}>
                        <Chevron open={isOpen(g.label)} />{g.label} <span className="muted" style={{ fontWeight: 400 }}>· {g.accounts.length}</span>
                      </td>
                      <td className="num" style={{ fontWeight: 600, color: balColor(g.balance) }}>{fmt(g.balance, idx.disp)}</td>
                    </tr>,
                    ...(isOpen(g.label) ? groupRows(g.accounts) : []),
                  ])}
                </tbody>
              </table>
              {!data.accounts.length && <div className="empty">No accounts yet.</div>}
              </div>
            </Panel>

            <Panel title="Where your money goes" action={<RangePicker compact alignRight value={sRange} onChange={setSRange} />}>
              <div className="panel-body">
                {spend.map((x, i) => (
                  <div className="spend-row" key={x.c.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <Dot color={rankColor(i)} />
                      <span className="ell">{x.c.name}</span>
                    </div>
                    <Bar width={(x.val / spendMax) * 100} color={rankColor(i)} />
                    <div className="r mono" style={{ fontSize: 12 }}>{fmt(x.val, idx.disp)}</div>
                    <div className="r mono muted" style={{ fontSize: 11.5 }}>{sExp ? Math.round((x.val / sExp) * 100) : 0}%</div>
                  </div>
                ))}
                {!spend.length && <div className="empty">No spending in this period.</div>}
              </div>
            </Panel>

            <Panel title="Income and expenses" action={
              <div className="panel-tools">
                <select className="select sm" value={shownUnit} onChange={e => setUnit(e.target.value as Unit | 'auto')} title="One bar per">
                  <option value="auto">Auto ({UNIT_NAME[autoUnit(cFrom, cTo)].toLowerCase()})</option>
                  {UNITS.map(u => (
                    <option key={u} value={u} disabled={!unitFits(cFrom, cTo, u)}>{UNIT_NAME[u]}</option>
                  ))}
                </select>
                <RangePicker compact alignRight value={cRange} onChange={setCRange} />
              </div>
            }>
              <div className="legend chart-legend">
                <span><Dot color="var(--acc)" />Income</span>
                <span><Dot color="var(--exp)" />Expenses</span>
              </div>
              <SizedBox style={{ padding: '10px 10px 6px', minHeight: 260 }}>{(w, h) => <ChartIE months={months} w={w} h={h} />}</SizedBox>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

const UNIT_KEY = 'ledger.unit.overview';

/** The chart's bar size, remembered per device; 'auto' sizes it to the range. */
function useUnit() {
  const [u, setU] = useState<Unit | 'auto'>(() => {
    try { const v = localStorage.getItem(UNIT_KEY); return v && (UNITS as string[]).includes(v) ? (v as Unit) : 'auto'; } catch { return 'auto'; }
  });
  const set = (v: Unit | 'auto') => {
    setU(v);
    try { localStorage.setItem(UNIT_KEY, v); } catch { /* storage unavailable */ }
  };
  return [u, set] as const;
}

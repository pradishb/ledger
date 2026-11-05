// Hand-rolled SVG charts, ported from the design. Values are cents.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { fmt, fmtK } from '../lib/format';
import { useLedger } from '../data/context';
import type { Month } from '../lib/dates';

/** Renders a chart at its container's real pixel width so text never scales. */
export function Sized({ children }: { children: (w: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref}>{w > 0 && children(w)}</div>;
}

/** Like Sized, but fills its container and passes both width and height. */
export function SizedBox({ children, style }: { children: (w: number, h: number) => ReactNode; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} style={{ flex: 1, minHeight: 0, ...style }}>{box.w > 0 && box.h > 0 && children(box.w, box.h)}</div>;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}

const TXT: CSSProperties = { fill: 'var(--ink3)', fontSize: 10.5, fontFamily: 'var(--mono)' };
const LBL: CSSProperties = { ...TXT, fontFamily: 'var(--sans)', fontSize: 11 };
const P = { l: 46, r: 8, t: 8, b: 22 };

function axis(els: ReactElement[], max: number, w: number, ih: number, cur: string) {
  for (let i = 0; i <= 4; i++) {
    const y = P.t + ih - (ih * i) / 4;
    els.push(<line key={`g${i}`} x1={P.l} x2={w - P.r} y1={y} y2={y} style={{ stroke: 'var(--line)' }} />);
    els.push(<text key={`t${i}`} x={P.l - 8} y={y + 3.5} textAnchor="end" style={TXT}>{fmtK((max * i) / 4, cur)}</text>);
  }
}

export interface IEMonth extends Month { inc: number; exp: number }

/** Narrowest a period's pair of bars may get; past that the chart scrolls sideways instead. */
const MIN_GW = 26;
/** Room for a horizontal scrollbar under a scrolling chart. */
const SCROLLBAR = 12;

export function ChartIE({ months, w, h }: { months: IEMonth[]; w: number; h: number }) {
  const cur = useLedger().idx.disp;
  const scrollRef = useRef<HTMLDivElement>(null);
  const fitW = w - P.l - P.r;
  const scrolls = fitW / Math.max(1, months.length) < MIN_GW;
  const gw = scrolls ? MIN_GW : fitW / Math.max(1, months.length);
  const plotW = gw * months.length + P.r;
  const ch = scrolls ? h - SCROLLBAR : h;
  const ih = ch - P.t - P.b;
  const max = niceMax(Math.max(1, ...months.map(m => Math.max(m.inc, m.exp))));
  const bw = Math.max(1, Math.min(16, gw * 0.3));
  // Label every nth bar so labels never overlap.
  const every = Math.max(1, Math.ceil(46 / gw));

  // Start at the latest period, and again whenever the range changes.
  const first = months[0]?.key, n = months.length;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [first, n, scrolls]);

  // The amount axis stays put; the grid, bars and labels scroll under it.
  const axisEls: ReactElement[] = [], els: ReactElement[] = [];
  for (let i = 0; i <= 4; i++) {
    const y = P.t + ih - (ih * i) / 4;
    axisEls.push(<text key={`t${i}`} x={P.l - 8} y={y + 3.5} textAnchor="end" style={TXT}>{fmtK((max * i) / 4, cur)}</text>);
    els.push(<line key={`g${i}`} x1={0} x2={plotW - P.r} y1={y} y2={y} style={{ stroke: 'var(--line)' }} />);
  }
  months.forEach((m, i) => {
    const cx = i * gw + gw / 2;
    const hi = Math.max(0, (m.inc / max) * ih), he = Math.max(0, (m.exp / max) * ih);
    els.push(<rect key={`i${i}`} x={cx - bw - 1} y={P.t + ih - hi} width={bw} height={hi} rx={2} style={{ fill: 'var(--acc)' }}><title>{`${m.full}: income ${fmt(m.inc, cur)}`}</title></rect>);
    els.push(<rect key={`e${i}`} x={cx + 1} y={P.t + ih - he} width={bw} height={he} rx={2} style={{ fill: 'var(--exp)' }}><title>{`${m.full}: expenses ${fmt(m.exp, cur)}`}</title></rect>);
    // Count labels from the latest bar, so the newest period is always labelled.
    if ((n - 1 - i) % every === 0) els.push(<text key={`l${i}`} x={cx} y={ch - 6} textAnchor="middle" style={LBL}>{m.label}</text>);
  });
  return (
    <div style={{ display: 'flex', width: w, height: h }}>
      <svg width={P.l} height={ch} style={{ display: 'block', flex: 'none' }}>{axisEls}</svg>
      <div ref={scrollRef} className="chart-scroll" style={{ flex: 1, minWidth: 0, overflowX: scrolls ? 'auto' : 'hidden', overflowY: 'hidden' }}>
        <svg width={plotW} height={ch} style={{ display: 'block' }}>{els}</svg>
      </div>
    </div>
  );
}

export interface Series { id: number; name: string; color: string; values: number[] }

export function ChartStack({ months, series, w, h }: { months: Month[]; series: Series[]; w: number; h: number }) {
  const cur = useLedger().idx.disp;
  const iw = w - P.l - P.r, ih = h - P.t - P.b;
  const totals = months.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i]), 0));
  const max = niceMax(Math.max(1, ...totals));
  const gw = iw / months.length, bw = Math.min(36, gw * 0.56);
  // Label every nth bar, counted from the newest, so labels never overlap.
  const every = Math.max(1, Math.ceil(46 / gw));
  const els: ReactElement[] = [];
  axis(els, max, w, ih, cur);
  months.forEach((m, i) => {
    const cx = P.l + i * gw + gw / 2;
    let y0 = P.t + ih;
    series.forEach((s, j) => {
      const v = Math.max(0, s.values[i]);
      const hh = (v / max) * ih;
      if (hh <= 0) return;
      y0 -= hh;
      els.push(<rect key={`s${i}-${j}`} x={cx - bw / 2} y={y0} width={bw} height={Math.max(0, hh - 1)} style={{ fill: s.color }}><title>{`${m.full} · ${s.name}: ${fmt(v, cur)}`}</title></rect>);
    });
    if ((months.length - 1 - i) % every === 0) els.push(<text key={`l${i}`} x={cx} y={h - 6} textAnchor="middle" style={LBL}>{m.label}</text>);
  });
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>{els}</svg>;
}


/** One value per period as a line with dots (net worth), with a zero line when it goes negative. */
export function ChartLine({ months, values, w, h, color = 'var(--acc)', name }: {
  months: Month[]; values: number[]; w: number; h: number; color?: string; name: string;
}) {
  const cur = useLedger().idx.disp;
  const iw = w - P.l - P.r, ih = h - P.t - P.b;
  const hi = niceMax(Math.max(0, ...values)), lo = -niceMax(Math.max(0, ...values.map(v => -v)));
  const top = Math.max(...values) > 0 ? hi : 0, bot = Math.min(...values) < 0 ? lo : 0;
  const span = top - bot || 1;
  const gw = iw / Math.max(1, months.length);
  const x = (i: number) => P.l + i * gw + gw / 2;
  const y = (v: number) => P.t + ih - ((v - bot) / span) * ih;
  const every = Math.max(1, Math.ceil(46 / gw));
  const els: ReactElement[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = bot + (span * i) / 4, gy = y(v);
    els.push(<line key={`g${i}`} x1={P.l} x2={w - P.r} y1={gy} y2={gy} style={{ stroke: 'var(--line)' }} />);
    els.push(<text key={`t${i}`} x={P.l - 8} y={gy + 3.5} textAnchor="end" style={TXT}>{fmtK(v, cur)}</text>);
  }
  if (bot < 0) els.push(<line key="zero" x1={P.l} x2={w - P.r} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--ink3)' }} />);
  if (values.length) {
    const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    els.push(<polygon key="area" points={`${x(0)},${y(0)} ${pts} ${x(values.length - 1)},${y(0)}`} style={{ fill: color, opacity: 0.12 }} />);
    els.push(<polyline key="line" points={pts} style={{ fill: 'none', stroke: color, strokeWidth: 2, strokeLinejoin: 'round' }} />);
  }
  months.forEach((m, i) => {
    els.push(<circle key={`p${i}`} cx={x(i)} cy={y(values[i])} r={gw < 12 ? 1.5 : 3} style={{ fill: color }}><title>{`${m.full} · ${name}: ${fmt(values[i], cur)}`}</title></circle>);
    if ((months.length - 1 - i) % every === 0) els.push(<text key={`l${i}`} x={x(i)} y={h - 6} textAnchor="middle" style={LBL}>{m.label}</text>);
  });
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>{els}</svg>;
}

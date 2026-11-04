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

export function ChartIE({ months, w, h }: { months: IEMonth[]; w: number; h: number }) {
  const cur = useLedger().idx.disp;
  const iw = w - P.l - P.r, ih = h - P.t - P.b;
  const max = niceMax(Math.max(1, ...months.map(m => Math.max(m.inc, m.exp))));
  const gw = iw / months.length, bw = Math.min(16, gw * 0.3);
  const els: ReactElement[] = [];
  axis(els, max, w, ih, cur);
  months.forEach((m, i) => {
    const cx = P.l + i * gw + gw / 2;
    const hi = Math.max(0, (m.inc / max) * ih), he = Math.max(0, (m.exp / max) * ih);
    els.push(<rect key={`i${i}`} x={cx - bw - 1} y={P.t + ih - hi} width={bw} height={hi} rx={2} style={{ fill: 'var(--acc)' }}><title>{`${m.full}: income ${fmt(m.inc, cur)}`}</title></rect>);
    els.push(<rect key={`e${i}`} x={cx + 1} y={P.t + ih - he} width={bw} height={he} rx={2} style={{ fill: 'var(--exp)' }}><title>{`${m.full}: expenses ${fmt(m.exp, cur)}`}</title></rect>);
    els.push(<text key={`l${i}`} x={cx} y={h - 6} textAnchor="middle" style={LBL}>{m.label}</text>);
  });
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>{els}</svg>;
}

export interface Series { id: number; name: string; color: string; values: number[] }

export function ChartStack({ months, series, w, h }: { months: Month[]; series: Series[]; w: number; h: number }) {
  const cur = useLedger().idx.disp;
  const iw = w - P.l - P.r, ih = h - P.t - P.b;
  const totals = months.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i]), 0));
  const max = niceMax(Math.max(1, ...totals));
  const gw = iw / months.length, bw = Math.min(36, gw * 0.56);
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
    els.push(<text key={`l${i}`} x={cx} y={h - 6} textAnchor="middle" style={LBL}>{m.label}</text>);
  });
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ display: 'block' }}>{els}</svg>;
}

export interface Seg { name: string; value: number; color: string }

export function Donut({ segs }: { segs: Seg[] }) {
  const cur = useLedger().idx.disp;
  const S = 220, r = 86, sw = 26, C = 2 * Math.PI * r;
  const tot = segs.reduce((a, s) => a + s.value, 0) || 1;
  let acc = 0;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} style={{ display: 'block' }}>
      <circle cx={S / 2} cy={S / 2} r={r} fill="none" strokeWidth={sw} style={{ stroke: 'var(--sunk)' }} />
      {segs.map((s, i) => {
        const len = (s.value / tot) * C;
        const el = (
          <circle key={i} cx={S / 2} cy={S / 2} r={r} fill="none" strokeWidth={sw}
            strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-acc}
            transform={`rotate(-90 ${S / 2} ${S / 2})`} style={{ stroke: s.color }}>
            <title>{`${s.name}: ${fmt(s.value, cur)}`}</title>
          </circle>
        );
        acc += len;
        return el;
      })}
    </svg>
  );
}

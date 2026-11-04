import { useEffect, useRef, useState, type ReactNode } from 'react';
import { isRange, RANGE_ROWS, rangeDates, rangeLabel, rangeName, type Range } from '../lib/dates';
import { useLedger } from '../data/context';

export function Seg<K extends string>({ options, value, onChange, className = '' }: {
  options: readonly (readonly [K, string])[];
  value: K;
  onChange: (k: K) => void;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`}>
      {options.map(([k, label]) => (
        <button type="button" key={k} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Page header. `primary` replaces the usual New transaction button with the page's own main action. */
export function Header({ title, subtitle, children, primary }: { title: string; subtitle?: string; children?: ReactNode; primary?: ReactNode }) {
  const { openAdd, online } = useLedger();
  return (
    <header className="hdr">
      <div className="hdr-title">
        <h1>{title}</h1>
        {subtitle && <span className="sub">{subtitle}</span>}
      </div>
      {children}
      {primary ?? (
        <button className="btn-primary hide-m" onClick={openAdd} disabled={!online}>
          New transaction<span className="kbd">N</span>
        </button>
      )}
    </header>
  );
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="t">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

export const Dot = ({ color, opacity = 1 }: { color: string; opacity?: number }) => (
  <span className="dot" style={{ background: color, opacity }} />
);

export const Bar = ({ width, color, opacity = 1, height = 8 }: { width: number; color: string; opacity?: number; height?: number }) => (
  <div className="bar" style={{ height }}>
    <div style={{ width: `${Math.max(0, Math.min(100, width)).toFixed(1)}%`, background: color, opacity }} />
  </div>
);

const OPEN_KEY = 'ledger.openGroups';

/** Which account groups are expanded. Collapsed by default; remembered per device. */
export function useOpenGroups() {
  const [open, setOpen] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]'); } catch { return []; }
  });
  const toggle = (g: string) => setOpen(prev => {
    const next = prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g];
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  return { isOpen: (g: string) => open.includes(g), toggle };
}

export const Chevron = ({ open }: { open: boolean }) => (
  <svg className={`chev${open ? ' open' : ''}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Currency codes for a picker: the ones in use first, then every other code. */
export function currencyOptions(used: string[], all: string[]) {
  const first = [...new Set(used)].sort();
  return { first, rest: all.filter(c => !first.includes(c)) };
}

export function CurrencySelect({ value, onChange, used, all, className = 'select', title, disabled }: {
  value: string; onChange: (c: string) => void; used: string[]; all: string[];
  className?: string; title?: string; disabled?: boolean;
}) {
  const { first, rest } = currencyOptions([...used, value], all);
  return (
    <select className={className} value={value} title={title} disabled={disabled} onChange={e => onChange(e.target.value)}>
      <optgroup label="In use">{first.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
      <optgroup label="All currencies">{rest.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
    </select>
  );
}

/** Picks the display currency for totals and reports, with the rates' date. */
export function DisplayCurrency() {
  const { data, idx, setDisp, ratesError } = useLedger();
  const all = idx.rates ? Object.keys(idx.rates.perUsd).sort() : [];
  const note = idx.rates ? `Rates ${shortDate(idx.rates.date)}` : ratesError ? 'Rates unavailable' : 'Loading rates…';
  return (
    <span className="disp-cur" title="Totals are converted to this currency at today's rates">
      <CurrencySelect value={idx.disp} onChange={setDisp} used={data.accounts.map(a => a.currency)} all={all} />
      <span className="muted small">{note}</span>
    </span>
  );
}

const shortDate = (s: string) =>
  new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** A date range choice remembered per device under `key`. */
export function useRange(key: string, initial: Range) {
  const k = `ledger.range.${key}`;
  const [r, setR] = useState<Range>(() => {
    try { const v = localStorage.getItem(k); return v && isRange(v) ? v : initial; } catch { return initial; }
  });
  const set = (v: Range) => {
    setR(v);
    try { localStorage.setItem(k, v); } catch { /* storage unavailable */ }
  };
  return [r, set] as const;
}

/** Button that opens a grid of date ranges, with the chosen range's dates beside it. */
export function RangePicker({ value, onChange, compact = false, alignRight = false }: {
  value: Range; onChange: (r: Range) => void;
  /** For panel headers: a smaller button, with the dates as its tooltip instead of beside it. */
  compact?: boolean;
  /** Open the list leftwards, for pickers near the right edge. */
  alignRight?: boolean;
}) {
  const { today } = useLedger();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [from, to] = rangeDates(value, today);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className={`range${compact ? ' compact' : ''}`} ref={ref}>
      <button type="button" className="select range-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="listbox"
        title={compact ? rangeLabel(from, to, today) : undefined}>
        {rangeName(value)}
      </button>
      {!compact && <span className="muted small">{rangeLabel(from, to, today)}</span>}
      {open && (
        <div className={`range-pop${alignRight ? ' right' : ''}`} role="listbox">
          {RANGE_ROWS.map((row, i) => row === 'divider'
            ? <div key={i} className="range-div" />
            : row.map(([k, label]) => (
              <button type="button" key={k} role="option" aria-selected={k === value} className={k === value ? 'on' : ''}
                onClick={() => { onChange(k); setOpen(false); }}>
                {label}
              </button>
            )))}
        </div>
      )}
    </div>
  );
}

/** Who is signed in, with a sign-out button. */
export function UserRow() {
  const { email, signOut } = useLedger();
  return (
    <div className="user-row">
      <span className="avatar" aria-hidden="true">{(email[0] ?? '?').toUpperCase()}</span>
      <span className="user-email ell" title={email}>{email || 'Signed in'}</span>
      <button type="button" className="icon-btn" onClick={() => confirm('Sign out of Ledger?') && signOut()} title="Sign out" aria-label="Sign out">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 11 13.5 8l-3-3M13.5 8H6" />
        </svg>
      </button>
    </div>
  );
}

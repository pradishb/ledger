import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { isRange, RANGE_ROWS, rangeDates, rangeLabel, rangeName, type Range } from '../lib/dates';
import { useLedger } from '../data/context';
import { useSearchParams } from 'react-router';

/**
 * A segmented switch (one of a few options). Radix ToggleGroup gives it arrow-key navigation and
 * proper radio semantics; the look stays the app's .seg style.
 */
export function Seg<K extends string>({ options, value, onChange, className = '' }: {
  options: readonly (readonly [K, string])[];
  value: K;
  onChange: (k: K) => void;
  className?: string;
}) {
  return (
    <ToggleGroupPrimitive.Root type="single" value={value} className={`seg ${className}`}
      // Clicking the chosen option again would clear it; a switch always has one value.
      onValueChange={v => { if (v) onChange(v as K); }}>
      {options.map(([k, label]) => (
        <ToggleGroupPrimitive.Item key={k} value={k} className={k === value ? 'on' : ''}>
          {label}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/** Page header, with the display currency picker on every page. `primary` replaces the usual New transaction button with the page's own main action. */
export function Header({ title, subtitle, children, primary }: { title: string; subtitle?: string; children?: ReactNode; primary?: ReactNode }) {
  const { openAdd, online } = useLedger();
  return (
    <header className="hdr">
      <div className="hdr-title">
        <h1>{title}</h1>
        {subtitle && <span className="sub">{subtitle}</span>}
      </div>
      {children}
      <DisplayCurrency />
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
      <span className="muted small hide-m">{note}</span>
    </span>
  );
}

const shortDate = (s: string) =>
  new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * A page's view choice (By payee, Income…) kept in the URL as ?key=value, so Back returns to the
 * same view. Changing it replaces the history entry instead of adding one; the default is left out.
 */
export function useUrlChoice<K extends string>(key: string, options: readonly K[], initial: K) {
  const [raw, setRaw] = useUrlText(key);
  const value = options.find(o => o === raw) ?? initial;
  const set = (v: K) => setRaw(v === initial ? '' : v);
  return [value, set] as const;
}

/** Free text kept in the URL as ?key=text (a search box), the same way; empty is left out. */
export function useUrlText(key: string) {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? '';
  const set = (v: string) => setParams(prev => {
    const next = new URLSearchParams(prev);
    if (v) next.set(key, v); else next.delete(key);
    return next;
  }, { replace: true });
  return [value, set] as const;
}

/** A set of ids kept in the URL as ?key=3,7 (expanded rows, hidden series), as { id: true }. */
export function useUrlIds(key: string) {
  const [raw, setRaw] = useUrlText(key);
  const ids: Record<number, boolean> = Object.fromEntries(raw.split(',').filter(Boolean).map(x => [Number(x), true]));
  const set = (v: Record<number, boolean> | ((prev: Record<number, boolean>) => Record<number, boolean>)) => {
    const next = typeof v === 'function' ? v(ids) : v;
    setRaw(Object.keys(next).filter(k => next[+k]).join(','));
  };
  return [ids, set] as const;
}

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
export function RangePicker({ value, onChange, compact = false, alignRight = false, custom }: {
  value: Range; onChange: (r: Range) => void;
  /** For panel headers: a smaller button, with the dates as its tooltip instead of beside it. */
  compact?: boolean;
  /** Open the list leftwards, for pickers near the right edge. */
  alignRight?: boolean;
  /** Exact dates that override `value` (from a link); the button shows them and no choice is ticked. */
  custom?: [string, string];
}) {
  const { today } = useLedger();
  const [open, setOpen] = useState(false);
  const [from, to] = custom ?? rangeDates(value, today);
  const sel = custom ? undefined : value;

  // Radix Popover handles outside clicks, Esc, focus and keeping the list on screen.
  return (
    <div className={`range${compact ? ' compact' : ''}`}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="select range-btn" aria-haspopup="listbox"
            title={compact ? rangeLabel(from, to, today) : undefined}>
            {custom ? rangeLabel(from, to, today) : rangeName(value)}
          </button>
        </PopoverTrigger>
        <PopoverContent align={alignRight ? 'end' : 'start'} sideOffset={4}
          className="grid w-[min(400px,calc(100vw-32px))] grid-cols-3 gap-0 p-1" role="listbox">
          {RANGE_ROWS.map((row, i) => row === 'divider'
            ? <div key={i} className="col-span-3 mx-0.5 my-1 h-px bg-border" />
            : row.map(([k, label]) => (
              <button type="button" key={k} role="option" aria-selected={k === sel}
                className={cn('truncate rounded-[5px] px-2 py-[7px] text-left text-[12.5px] hover:bg-accent',
                  k === sel && 'bg-primary text-primary-foreground hover:bg-primary')}
                onClick={() => { onChange(k); setOpen(false); }}>
                {label}
              </button>
            )))}
        </PopoverContent>
      </Popover>
      {!compact && <span className="muted small">{rangeLabel(from, to, today)}</span>}
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

/**
 * The app's dialog: shadcn/Radix Dialog (focus trap, Esc, inert background, focus restore) with a
 * header, a scrolling body and a footer. Full screen on phones.
 */
export function SheetDialog({ title, head, children, foot, onClose, width = 660, onSubmit }: {
  title: string;
  /** Extra header controls, between the title and the close button. */
  head?: ReactNode;
  children: ReactNode;
  foot: ReactNode;
  onClose: () => void;
  width?: number;
  /** Makes the dialog a form: Enter submits. */
  onSubmit?: () => void;
}) {
  const Body = onSubmit ? 'form' : 'div';
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} style={{ maxWidth: `min(${width}px, calc(100% - 2rem))` }}
        className={cn('flex max-h-[calc(100dvh-32px)] flex-col gap-0 overflow-hidden rounded-[10px] bg-card p-0 shadow-[var(--shadow)]',
          'max-[760px]:h-dvh max-[760px]:max-h-none max-[760px]:!max-w-none max-[760px]:rounded-none max-[760px]:border-0')}>
        <Body className="contents" onSubmit={onSubmit ? e => { e.preventDefault(); onSubmit(); } : undefined}>
          <div className="sheet-head">
            <DialogTitle className="t">{title}</DialogTitle>
            {head}
            <DialogClose className="x" title="Close (Esc)">×</DialogClose>
          </div>
          <div className="sheet-body">{children}</div>
          <div className="sheet-foot">{foot}</div>
        </Body>
      </DialogContent>
    </Dialog>
  );
}

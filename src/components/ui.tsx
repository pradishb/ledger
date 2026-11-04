import type { ReactNode } from 'react';
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

export function Header({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  const { openAdd, online } = useLedger();
  return (
    <header className="hdr">
      <div className="hdr-title">
        <h1>{title}</h1>
        {subtitle && <span className="sub">{subtitle}</span>}
      </div>
      {children}
      <button className="btn-primary hide-m" onClick={openAdd} disabled={!online}>
        New transaction<span className="kbd">N</span>
      </button>
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

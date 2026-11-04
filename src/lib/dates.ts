// Dates are local "YYYY-MM-DD" strings, compared lexically.
import { LOCALE } from './format';

export const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (s: string) => s.split('-').map(Number) as [number, number, number];

export function todayStr() {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export const addMonths = (y: number, m: number, k: number): [number, number] => {
  const t = y * 12 + (m - 1) + k;
  return [Math.floor(t / 12), (t % 12) + 1];
};
export const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

export function addDays(s: string, k: number) {
  const [y, m, d] = parts(s);
  const dt = new Date(y, m - 1, d + k);
  return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** "Nov 3", or "Nov 3 '25" outside the current year. */
export function fdate(s: string, today: string) {
  const [y, m, d] = parts(s);
  return `${MO[m - 1]} ${d}` + (s.slice(0, 4) === today.slice(0, 4) ? '' : ` '${String(y).slice(2)}`);
}

export function longDate(s: string) {
  const [y, m, d] = parts(s);
  return new Date(y, m - 1, d).toLocaleDateString(LOCALE, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

export interface Month {
  key: string;
  from: string;
  to: string;
  label: string;
  full: string;
}

const monthOf = (y: number, m: number): Month => ({
  key: `${y}-${pad(m)}`,
  from: ymd(y, m, 1),
  to: ymd(y, m, lastDay(y, m)),
  label: MO[m - 1],
  full: `${MO[m - 1]} ${y}`,
});

/** The last n complete months, oldest first (the current month is excluded). */
export function monthsBack(n: number, today: string): Month[] {
  const [y, m] = parts(today);
  const out: Month[] = [];
  for (let i = n; i >= 1; i--) out.push(monthOf(...addMonths(y, m, -i)));
  return out;
}

export const PERIODS = [
  ['tm', 'This month'], ['lm', 'Last month'], ['3m', 'Last 3 months'],
  ['ytd', 'Year to date'], ['12m', 'Last 12 months'], ['all', 'All time'],
] as const;
export type Period = (typeof PERIODS)[number][0];

export function periodRange(k: Period, today: string): [string, string] {
  const [y, m] = parts(today);
  const prev = (n: number) => monthOf(...addMonths(y, m, -n));
  switch (k) {
    case 'tm': return [ymd(y, m, 1), today];
    case 'lm': return [prev(1).from, prev(1).to];
    case '3m': return [prev(3).from, prev(1).to];
    case 'ytd': return [ymd(y, 1, 1), today];
    case '12m': return [prev(12).from, prev(1).to];
    case 'all': return ['0000', today];
  }
}

export const REG_RANGES = [
  ['30d', 'Last 30 days'], ['3m', 'Last 3 months'], ['ytd', 'This year'], ['all', 'All dates'],
] as const;
export type RegRange = (typeof REG_RANGES)[number][0];

export function regFrom(k: RegRange, today: string) {
  const [y, m] = parts(today);
  switch (k) {
    case '30d': return addDays(today, -30);
    case '3m': return monthOf(...addMonths(y, m, -3)).from;
    case 'ytd': return ymd(y, 1, 1);
    case 'all': return '';
  }
}

export function rangeLabel(from: string, to: string, today: string) {
  const year = today.slice(0, 4);
  const suffix = to.startsWith(year) ? `, ${year}` : '';
  if (from === '0000') return `Through ${fdate(to, today)}${suffix}`;
  return `${fdate(from, today)} – ${fdate(to, today)}${suffix}`;
}

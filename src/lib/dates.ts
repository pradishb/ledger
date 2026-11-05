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

/** Date range choices, laid out three per row like the picker shows them. */
export const RANGE_ROWS = [
  [['yday', 'Yesterday'], ['today', 'Today'], ['tmrw', 'Tomorrow']],
  [['lweek', 'Last Week'], ['tweek', 'This Week'], ['nweek', 'Next Week']],
  [['lfort', 'Last Fortnight'], ['tfort', 'This Fortnight'], ['nfort', 'Next Fortnight']],
  [['lmonth', 'Last Month'], ['tmonth', 'This Month'], ['nmonth', 'Next Month']],
  [['lqtr', 'Last Quarter'], ['tqtr', 'This Quarter'], ['nqtr', 'Next Quarter']],
  [['lyear', 'Last Year'], ['tyear', 'This Year'], ['nyear', 'Next Year']],
  'divider',
  [['ytd', 'Year to date'], ['mtd', 'Month to date'], ['atd', 'All to date']],
  [['l90', 'Last 90 Days'], ['l60', 'Last 60 Days'], ['l30', 'Last 30 Days']],
  [['l12m', 'Last 12 Months'], ['around', '30 Days Around'], ['all', 'All Dates']],
] as const;
type Row = Exclude<(typeof RANGE_ROWS)[number], 'divider'>;
export type Range = Row[number][0];
export const RANGES: readonly (readonly [Range, string])[] = RANGE_ROWS.flatMap((r): readonly (readonly [Range, string])[] => (r === 'divider' ? [] : r));
export const rangeName = (k: Range) => RANGES.find(r => r[0] === k)?.[1] ?? k;
export const isRange = (k: string): k is Range => RANGES.some(r => r[0] === k);

/** First day of the week for the locale: 0 = Sunday ... 6 = Saturday. Monday if unknown. */
const WEEK_START = (() => {
  try {
    const loc = new Intl.Locale(LOCALE ?? navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number };
    };
    const first = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay;
    return first ? first % 7 : 1;
  } catch { return 1; }
})();

/** Inclusive [from, to]. Open-ended ranges use '0000' and '9999'. */
export function rangeDates(k: Range, today: string): [string, string] {
  const [y, m, d] = parts(today);
  const dow = new Date(y, m - 1, d).getDay();
  const week = (n: number): [string, string] => {
    const s = addDays(today, -((dow - WEEK_START + 7) % 7) + 7 * n);
    return [s, addDays(s, 6)];
  };
  // Fortnights are 14-day blocks counted from a fixed week start, so they don't shift.
  const fort = (n: number): [string, string] => {
    const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1970, 0, 4 + WEEK_START)) / 864e5);
    const s = addDays(today, -(((days % 14) + 14) % 14) + 14 * n);
    return [s, addDays(s, 13)];
  };
  const month = (n: number): [string, string] => { const x = monthOf(...addMonths(y, m, n)); return [x.from, x.to]; };
  const qtr = (n: number): [string, string] => {
    const [qy, qm] = addMonths(y, m - ((m - 1) % 3), 3 * n);
    const [ey, em] = addMonths(qy, qm, 2);
    return [ymd(qy, qm, 1), ymd(ey, em, lastDay(ey, em))];
  };
  const year = (n: number): [string, string] => [ymd(y + n, 1, 1), ymd(y + n, 12, 31)];
  const days = (n: number): [string, string] => [addDays(today, -(n - 1)), today];
  switch (k) {
    case 'yday': return [addDays(today, -1), addDays(today, -1)];
    case 'today': return [today, today];
    case 'tmrw': return [addDays(today, 1), addDays(today, 1)];
    case 'lweek': return week(-1);
    case 'tweek': return week(0);
    case 'nweek': return week(1);
    case 'lfort': return fort(-1);
    case 'tfort': return fort(0);
    case 'nfort': return fort(1);
    case 'lmonth': return month(-1);
    case 'tmonth': return month(0);
    case 'nmonth': return month(1);
    case 'lqtr': return qtr(-1);
    case 'tqtr': return qtr(0);
    case 'nqtr': return qtr(1);
    case 'lyear': return year(-1);
    case 'tyear': return year(0);
    case 'nyear': return year(1);
    case 'ytd': return [ymd(y, 1, 1), today];
    case 'mtd': return [ymd(y, m, 1), today];
    case 'atd': return ['0000', today];
    case 'l90': return days(90);
    case 'l60': return days(60);
    case 'l30': return days(30);
    case 'l12m': return [month(-12)[0], month(-1)[1]];
    case 'around': return [addDays(today, -15), addDays(today, 15)];
    case 'all': return ['0000', '9999'];
  }
}

export function rangeLabel(from: string, to: string, today: string) {
  if (from === '0000' && to === '9999') return 'Every date';
  if (from === '0000') return `Through ${fdate(to, today)}`;
  if (from === to) return fdate(from, today);
  return `${fdate(from, today)} – ${fdate(to, today)}`;
}

export type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year';
export const UNITS: Unit[] = ['day', 'week', 'month', 'quarter', 'year'];
export const UNIT_NAME: Record<Unit, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' };
const UNIT_DAYS: Record<Unit, number> = { day: 1, week: 7, month: 30.4, quarter: 91.3, year: 365.25 };
/** More bars than this and a chart stops being readable. */
const MAX_BARS = 400;

const spanDays = (from: string, to: string) => {
  const [fy, fm, fd] = parts(from), [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 864e5) + 1;
};

/** The unit that suits the span: about 30 bars or fewer at the finest grain that fits. */
export function autoUnit(from: string, to: string): Unit {
  const span = spanDays(from, to);
  return span <= 31 ? 'day' : span <= 92 ? 'week' : span <= 1100 ? 'month' : 'year';
}

/** How many `unit`s [from, to] spans, counting part-covered months by their share of days, so Last Month is exactly 1 month. */
export function periodsIn(from: string, to: string, unit: Unit): number {
  if (unit === 'day' || unit === 'week') return spanDays(from, to) / (unit === 'day' ? 1 : 7);
  const [fy, fm] = parts(from), [ty, tm] = parts(to);
  let months = 0;
  for (let [y, m] = [fy, fm]; y * 12 + m <= ty * 12 + tm; [y, m] = addMonths(y, m, 1)) {
    const s = ymd(y, m, 1), e = ymd(y, m, lastDay(y, m));
    months += spanDays(s < from ? from : s, e > to ? to : e) / lastDay(y, m);
  }
  return unit === 'month' ? months : months / (unit === 'quarter' ? 3 : 12);
}

/** The unit an average over [from, to] reads best in: one step finer than the range (a month's average per week). */
export function avgUnit(from: string, to: string): Unit {
  const span = spanDays(from, to);
  return span <= 14 ? 'day' : span <= 92 ? 'week' : span <= 1100 ? 'month' : 'year';
}

/** Whether charting [from, to] by `unit` stays under MAX_BARS bars. */
export const unitFits = (from: string, to: string, unit: Unit) => spanDays(from, to) / UNIT_DAYS[unit] <= MAX_BARS;

/** Split [from, to] into chart bars of `unit` (or one sized to fit); the first and last are clipped to the range. */
export function buckets(from: string, to: string, want?: Unit): { unit: Unit; list: Month[] } {
  const [fy, fm, fd] = parts(from), [ty, tm] = parts(to);
  const unit: Unit = want && unitFits(from, to, want) ? want : autoUnit(from, to);
  const list: Month[] = [];
  const push = (s: string, e: string, label: string, full: string) =>
    list.push({ key: s, from: s < from ? from : s, to: e > to ? to : e, label, full });
  if (unit === 'day') {
    for (let s = from; s <= to; s = addDays(s, 1)) push(s, s, String(+s.slice(8)), fdate(s, to));
  } else if (unit === 'week') {
    const dow = new Date(fy, fm - 1, fd).getDay();
    for (let s = addDays(from, -((dow - WEEK_START + 7) % 7)); s <= to; s = addDays(s, 7)) {
      const e = addDays(s, 6);
      push(s, e, fdate(s < from ? from : s, to), `${fdate(s < from ? from : s, to)} – ${fdate(e > to ? to : e, to)}`);
    }
  } else if (unit === 'month') {
    for (let [y, m] = [fy, fm]; y * 12 + m <= ty * 12 + tm; [y, m] = addMonths(y, m, 1)) {
      const x = monthOf(y, m);
      push(x.from, x.to, x.label + (m === 1 || !list.length ? ` '${String(y).slice(2)}` : ''), x.full);
    }
  } else if (unit === 'quarter') {
    for (let [y, q] = [fy, Math.ceil(fm / 3)]; y * 4 + q <= ty * 4 + Math.ceil(tm / 3); q === 4 ? (y++, q = 1) : q++) {
      const m = q * 3 - 2;
      push(ymd(y, m, 1), ymd(y, m + 2, lastDay(y, m + 2)), `Q${q} '${String(y).slice(2)}`, `Q${q} ${y}`);
    }
  } else {
    for (let y = fy; y <= ty; y++) push(ymd(y, 1, 1), ymd(y, 12, 31), String(y), String(y));
  }
  return { unit, list };
}

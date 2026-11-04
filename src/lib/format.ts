export const LOCALE: string | undefined = import.meta.env.VITE_LOCALE || undefined;

type Style = 'full' | 'whole' | 'compact';
const cache = new Map<string, Intl.NumberFormat>();
function formatter(cur: string, style: Style) {
  const key = `${cur}|${style}`;
  let f = cache.get(key);
  if (!f) {
    const opts: Intl.NumberFormatOptions = { style: 'currency', currency: cur };
    if (style === 'whole') Object.assign(opts, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    if (style === 'compact') Object.assign(opts, { notation: 'compact', maximumFractionDigits: 1 });
    try { f = new Intl.NumberFormat(LOCALE, opts); } catch { f = new Intl.NumberFormat(LOCALE, { ...opts, currency: 'XXX' }); }
    cache.set(key, f);
  }
  return f;
}

// `|| 0` turns -0 into 0 so we never print "-$0.00". `cur` is an ISO currency code.
export const fmt = (cents: number, cur: string) => formatter(cur, 'full').format(cents / 100 || 0);
export const fmt0 = (cents: number, cur: string) => formatter(cur, 'whole').format(Math.round(cents / 100) || 0);
export const fmtK = (cents: number, cur: string) => formatter(cur, 'compact').format(cents / 100 || 0);

export const currencySymbol = (cur: string) =>
  formatter(cur, 'full').formatToParts(0).find(p => p.type === 'currency')?.value ?? cur;

/** Parse user input like "1,234.56", "$12" or "12,50" into cents. NaN if invalid. */
export function parseMoney(input: string): number {
  let s = String(input).trim().replace(/[^\d.,-]/g, '');
  s = s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.');
  if (!/^-?\d*\.?\d*$/.test(s) || !/\d/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100);
}

/** Like parseMoney but 0 for blank/invalid input; for live totals. */
export const centsOr0 = (input: string) => {
  const c = parseMoney(input);
  return Number.isFinite(c) ? c : 0;
};

export const centsToInput = (cents: number) => (Math.abs(cents) / 100).toFixed(2);

export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const m = String((e as { message: unknown }).message);
    if (m) return m;
  }
  return String(e);
}

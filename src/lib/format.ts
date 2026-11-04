const CURRENCY = import.meta.env.VITE_CURRENCY || 'USD';
export const LOCALE: string | undefined = import.meta.env.VITE_LOCALE || undefined;

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY });
const money0 = new Intl.NumberFormat(LOCALE, {
  style: 'currency', currency: CURRENCY, minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const moneyK = new Intl.NumberFormat(LOCALE, {
  style: 'currency', currency: CURRENCY, notation: 'compact', maximumFractionDigits: 1,
});

// `|| 0` turns -0 into 0 so we never print "-$0.00".
export const fmt = (cents: number) => money.format(cents / 100 || 0);
export const fmt0 = (cents: number) => money0.format(Math.round(cents / 100) || 0);
export const fmtK = (cents: number) => moneyK.format(cents / 100 || 0);

export const currencySymbol =
  money.formatToParts(0).find(p => p.type === 'currency')?.value ?? '$';

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

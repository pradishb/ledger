// Today's exchange rates, from the free daily currency API by fawazahmed0
// (https://github.com/fawazahmed0/exchange-api): no key, includes NPR.
// Cached with the rest of the query cache, so the last rates also work offline.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

export interface Rates {
  /** Day the rates are for, YYYY-MM-DD. */
  date: string;
  /** Units of each currency per 1 USD, keyed by upper-case ISO code. */
  perUsd: Record<string, number>;
}

const SOURCES = [
  'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
];

async function fetchRates(): Promise<Rates> {
  let last: unknown;
  for (const url of SOURCES) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Rates request failed (${res.status})`);
      const j = (await res.json()) as { date: string; usd: Record<string, number> };
      const perUsd: Record<string, number> = {};
      for (const [k, v] of Object.entries(j.usd)) if (/^[a-z]{3}$/.test(k) && v > 0) perUsd[k.toUpperCase()] = v;
      perUsd.USD = 1;
      return { date: j.date, perUsd };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export function useRates() {
  return useQuery({
    queryKey: ['rates'],
    queryFn: fetchRates,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });
}

/** Currencies the browser can format, for pickers. */
export const CURRENCY_CODES: string[] = (() => {
  try { return Intl.supportedValuesOf('currency'); } catch { return ['EUR', 'GBP', 'INR', 'NPR', 'USD']; }
})();

const DISPLAY_KEY = 'ledger.displayCurrency';
export const DEFAULT_CURRENCY = 'USD';

/** The currency totals and reports are shown in; remembered per device. */
export function useDisplayCurrency() {
  const [cur, setCur] = useState(() => {
    try { return localStorage.getItem(DISPLAY_KEY) || DEFAULT_CURRENCY; } catch { return DEFAULT_CURRENCY; }
  });
  const set = (c: string) => {
    setCur(c);
    try { localStorage.setItem(DISPLAY_KEY, c); } catch { /* storage unavailable */ }
  };
  return [cur, set] as const;
}

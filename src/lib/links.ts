// Links into the Transactions page with its filters set, e.g. from a category on Statistics.

/** Open-ended range edges (see rangeDates) aren't real dates, so they're left out of the link. */
const realDate = (d?: string) => (d && d !== '0000' && d !== '9999' ? d : '');

export function txnsLink(f: { account?: number; category?: number; payee?: number; kind?: 'exp' | 'inc' | 'xfer'; from?: string; to?: string }) {
  const p = new URLSearchParams();
  if (f.account) p.set('account', String(f.account));
  if (f.category) p.set('category', String(f.category));
  if (f.payee !== undefined) p.set('payee', String(f.payee));
  if (f.kind) p.set('kind', f.kind);
  if (realDate(f.from)) p.set('from', f.from!);
  if (realDate(f.to)) p.set('to', f.to!);
  const q = p.toString();
  return `/transactions${q ? `?${q}` : ''}`;
}

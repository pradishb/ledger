// Dev-only preview: the real app on made-up data, with no sign-in and no Supabase reads.
// Open /preview.html?page=/accounts&theme=dark while `npm run dev` is running.
// Saving anything here fails (there's no session), which is fine for looking at layouts.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../index.css';
import { LEDGER_KEY } from '../data/api';
import { applyTheme } from '../data/hooks';
import { AppRoutes } from '../routes';
import type { Account, Category, LedgerData, Payee, Txn } from '../lib/types';

const q = new URLSearchParams(location.search);
// Start from a clean slate so saved filters and column layouts don't leak into screenshots.
if (!q.has('keep')) try { localStorage.clear(); } catch { /* ignore */ }
// applyTheme also saves the choice, so the app's theme switch shows it too.
applyTheme(q.get('theme') === 'dark' ? 'dark' : 'light');

// --- Sample ledger. A fixed seed keeps screenshots stable. ---
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const accounts: Account[] = [
  { id: 1, name: 'NIC Asia Savings', type: 'bank', group: 'Liquid', opening: 120000000, sort: 0, currency: 'NPR', hidden: false, growth: '4.5% p.a.' },
  { id: 2, name: 'Global IME USD', type: 'bank', group: 'Liquid', opening: 50000, sort: 1, currency: 'USD', hidden: false, growth: '' },
  { id: 3, name: 'Wallet', type: 'cash', group: 'Liquid', opening: 1500000, sort: 2, currency: 'NPR', hidden: false, growth: '' },
  { id: 4, name: 'Sarangkot FD 11%', type: 'asset', group: 'Investments', opening: 500000000, sort: 3, currency: 'NPR', hidden: false, growth: '11% p.a.' },
  { id: 5, name: 'NEPSE shares', type: 'asset', group: 'Investments', opening: 860000000, sort: 4, currency: 'NPR', hidden: false, growth: '' },
  { id: 6, name: 'Rajesh', type: 'asset', group: 'Receivables', opening: 7193000, sort: 5, currency: 'NPR', hidden: false, growth: '' },
  { id: 7, name: 'Visa card', type: 'credit', group: '', opening: -4520000, sort: 6, currency: 'NPR', hidden: false, growth: '' },
  { id: 8, name: 'Old Bag account', type: 'cash', group: 'Pre-2024', opening: 0, sort: 7, currency: 'NPR', hidden: true, growth: '' },
];
const PAL = ['oklch(0.56 0.09 155)', 'oklch(0.72 0.13 80)', 'oklch(0.6 0.11 245)', 'oklch(0.64 0.14 30)', 'oklch(0.58 0.13 305)'];
const cats: Category[] = [
  { id: 1, name: 'Groceries', parent: 0, type: 'exp', color: PAL[0] },
  { id: 2, name: 'Eating Out', parent: 0, type: 'exp', color: PAL[1] },
  { id: 3, name: 'Home Improvement', parent: 0, type: 'exp', color: PAL[2] },
  { id: 4, name: 'Fuel', parent: 0, type: 'exp', color: PAL[3] },
  { id: 5, name: 'Electricity', parent: 0, type: 'exp', color: PAL[4] },
  { id: 6, name: 'Healthcare', parent: 0, type: 'exp', color: PAL[0] },
  { id: 7, name: 'Salary', parent: 0, type: 'inc', color: PAL[0] },
  { id: 8, name: 'Interest', parent: 0, type: 'inc', color: PAL[2] },
  { id: 9, name: 'Vegetables', parent: 1, type: 'exp', color: null },
];
const payees: Payee[] = ['Bhatbhateni', 'Salesberry', 'Himalayan Java', 'Nepal Oil Corp', 'NEA', 'Sandbox', 'Grande Hospital', 'Daraz']
  .map((name, i) => ({ id: i + 1, name, match: [name] }));

const txns: Txn[] = [];
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
let id = 1;
// ?big makes about 6,000 transactions, like a real multi-year ledger, for checking speed.
const DAYS = q.has('big') ? 2900 : 400;
for (let n = DAYS; n >= 0; n--) {
  if (n % 30 === 3) txns.push({ id: id++, date: day(n), acc: 1, xfer: 0, amount: 18500000, xamt: null, pay: 'Bank transfer', info: '', payee: 6, cat: 7, memo: 'Monthly salary', tags: [], splits: null });
  if (n % 30 === 10) txns.push({ id: id++, date: day(n), acc: 4, xfer: 0, amount: 458300, xamt: null, pay: 'None', info: '', payee: 0, cat: 8, memo: '', tags: [], splits: null });
  const k = Math.floor(rnd() * 3) + (q.has('big') ? 1 : 0);
  for (let j = 0; j < k; j++) {
    const cat = pick([1, 1, 2, 2, 3, 4, 5, 6, 9]);
    const acc = pick([1, 1, 3, 7]);
    txns.push({
      id: id++, date: day(n), acc, xfer: 0, amount: -Math.round(20000 + rnd() * (cat === 3 ? 6000000 : 900000)), xamt: null,
      pay: pick(['None', 'Debit card', 'Cash', 'Credit card']), info: '', payee: pick([1, 2, 3, 4, 5, 7, 8]), cat,
      memo: pick(['', '', 'weekly shop', 'with family', 'repair']), tags: rnd() < 0.15 ? ['home'] : [], splits: null,
    });
  }
  if (n % 45 === 20) txns.push({ id: id++, date: day(n), acc: 1, xfer: 3, amount: -2000000, xamt: null, pay: 'None', info: '', payee: 0, cat: 0, memo: 'ATM', tags: [], splits: null });
}
txns.push({ id: id++, date: day(60), acc: 1, xfer: 2, amount: -6100000, xamt: 50000, pay: 'Bank transfer', info: '', payee: 0, cat: 0, memo: 'To USD', tags: [], splits: null });

const data: LedgerData = { accounts, cats, payees, txns };

const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
client.setQueryData(LEDGER_KEY, data);
client.setQueryData(['rates'], { date: day(0), perUsd: { USD: 1, NPR: 133.4, EUR: 0.92 } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[q.get('page') ?? '/']}>
        <AppRoutes onSignOut={() => alert('Sign out (preview)')} email="preview@example.com" />
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>,
);

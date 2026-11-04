import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchLedger, LEDGER_KEY } from '../data/api';
import { LedgerContext, type LedgerCtx } from '../data/context';
import { applyTheme, initialTheme, useIsMobile, useOnline, type Theme } from '../data/hooks';
import { useDisplayCurrency, useRates } from '../data/rates';
import { balances, buildIndex, sumBy } from '../lib/ledger';
import { todayStr } from '../lib/dates';
import { errorMessage } from '../lib/format';
import type { Txn } from '../lib/types';
import { blankDraft, draftFromTxn, TxnModal, type Draft } from './TxnModal';
import { Seg, UserRow } from './ui';

export function Layout({ onSignOut, email }: { onSignOut: () => void; email: string }) {
  const online = useOnline();
  const isMobile = useIsMobile();
  const query = useQuery({ queryKey: LEDGER_KEY, queryFn: fetchLedger });
  const rates = useRates();
  const [disp, setDisp] = useDisplayCurrency();
  const data = query.data;
  const today = todayStr();
  // The account being viewed on Transactions, so New transaction starts in it.
  const loc = useLocation();
  const curAcc = loc.pathname === '/transactions' ? Number(new URLSearchParams(loc.search).get('account')) || 0 : 0;

  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const setTheme = useCallback((t: Theme) => { applyTheme(t); setThemeState(t); }, []);

  const [modal, setModal] = useState<{ draft: Draft; n: number } | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<number>(undefined);
  const toast = useCallback((msg: string) => {
    window.clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2200);
  }, []);

  const idx = useMemo(() => data && buildIndex(data, disp, rates.data), [data, disp, rates.data]);
  const bal = useMemo(() => data && balances(data, today), [data, today]);

  const openAdd = useCallback(() => {
    if (!data) return;
    if (!data.accounts.length) return toast('Add an account first');
    const shown = data.accounts.filter(a => !a.hidden || a.id === curAcc);
    if (!shown.length) return toast('All accounts are hidden');
    setModal({ draft: blankDraft(shown, today, {}, curAcc), n: Date.now() });
  }, [data, today, curAcc, toast]);
  const openEdit = useCallback((t: Txn) => {
    if (data) setModal({ draft: draftFromTxn(t, data.accounts), n: Date.now() });
  }, [data]);
  const closeModal = useCallback(() => setModal(null), []);
  // A page can claim N for its own main action, such as New account on the Accounts page.
  const newShortcut = useRef<(() => void) | null>(null);
  const setNewShortcut = useCallback((fn: (() => void) | null) => { newShortcut.current = fn; }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName?.toLowerCase();
      if (modal || ['input', 'select', 'textarea'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === 'n' || e.key === 'N') && online) { e.preventDefault(); (newShortcut.current ?? openAdd)(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, online, openAdd]);

  if (!data || !idx || !bal) {
    return (
      <div className="center-screen">
        {query.isError ? (
          <div className="panel login">
            <b>Couldn't load your data</b>
            <span className="muted">{errorMessage(query.error)}</span>
            <div className="toolbar">
              <button className="btn-primary" onClick={() => query.refetch()}>Retry</button>
              <button className="btn" onClick={onSignOut}>Sign out</button>
            </div>
          </div>
        ) : <span className="muted">Loading…</span>}
      </div>
    );
  }

  const netWorth = sumBy(data.accounts, a => idx.toDisp(a.id, bal.get(a.id) ?? 0));
  const ctx: LedgerCtx = {
    data, idx, bal, netWorth, setDisp, ratesError: rates.isError && !rates.data, today, online, isMobile, theme, setTheme,
    openAdd, setNewShortcut, openEdit, toast, signOut: onSignOut, email,
  };

  return (
    <LedgerContext.Provider value={ctx}>
      <div className="app">
        <aside className="side">
          <div className="brand"><div className="logo">L</div>Ledger</div>
          <nav className="nav">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `navbtn${isActive ? ' active' : ''}`}>{label}</NavLink>
            ))}
          </nav>
          <div className="side-foot">
            <Seg className="md bg" value={theme} onChange={setTheme} options={[['light', 'Light'], ['dark', 'Dark']] as const} />
            <UserRow />
          </div>
        </aside>

        <main className="main">
          {!online && <div className="offline">Offline. You're seeing your last saved data, and editing is turned off until you reconnect.</div>}
          <Outlet />
        </main>

        <nav className="tabbar">
          {TABS.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={icon} /></svg>
              {label}
            </NavLink>
          ))}
        </nav>
        <button className="fab" onClick={openAdd} disabled={!online} aria-label="New transaction">+</button>

        {modal && <TxnModal key={modal.n} initial={modal.draft} onClose={closeModal} />}
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      </div>
    </LedgerContext.Provider>
  );
}

const NAV: [string, string][] = [
  ['/', 'Overview'], ['/accounts', 'Accounts'], ['/transactions', 'Transactions'],
  ['/stats', 'Statistics'], ['/trend', 'Trend over time'], ['/categories', 'Categories & payees'],
];

const TABS: [string, string, string][] = [
  ['/', 'Overview', 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'],
  ['/accounts', 'Accounts', 'M3 10h18M5 10v8m4.7-8v8m4.6-8v8M19 10v8M3 21h18M12 3l9 5H3z'],
  ['/transactions', 'Transactions', 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01'],
  ['/stats', 'Stats', 'M12 3a9 9 0 1 0 9 9h-9z M15 3.5A9 9 0 0 1 20.5 9H15z'],
  ['/more', 'More', 'M5 12h.01M12 12h.01M19 12h.01'],
];

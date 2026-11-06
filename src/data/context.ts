import { createContext, useContext } from 'react';
import type { Index } from '../lib/ledger';
import type { LedgerData, Txn } from '../lib/types';
import type { Theme } from './hooks';

export interface LedgerCtx {
  data: LedgerData;
  idx: Index;
  bal: Map<number, number>;
  netWorth: number;
  setDisp: (cur: string) => void;
  /** Rates fetch state, for the "as of" note. */
  ratesError: boolean;
  today: string;
  online: boolean;
  isMobile: boolean;
  theme: Theme;
  setTheme: (t: Theme) => void;
  openAdd: () => void;
  /** Let the current page take over the N shortcut (null gives it back to New transaction). */
  setNewShortcut: (fn: (() => void) | null) => void;
  openEdit: (t: Txn) => void;
  /** Show a short message; with `undo`, it gets an Undo button that runs it and refreshes the data. */
  toast: (msg: string, undo?: () => Promise<unknown>) => void;
  signOut: () => void;
  /** Signed-in user's email; empty when offline with an expired session. */
  email: string;
}

export const LedgerContext = createContext<LedgerCtx | null>(null);

export function useLedger() {
  const c = useContext(LedgerContext);
  if (!c) throw new Error('useLedger must be used inside <Layout>');
  return c;
}

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
  openEdit: (t: Txn) => void;
  toast: (msg: string) => void;
  signOut: () => void;
}

export const LedgerContext = createContext<LedgerCtx | null>(null);

export function useLedger() {
  const c = useContext(LedgerContext);
  if (!c) throw new Error('useLedger must be used inside <Layout>');
  return c;
}

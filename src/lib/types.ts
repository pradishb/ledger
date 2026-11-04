// Domain types. Money is always integer cents in the account's own currency; "no reference" is 0.

export type AccountType = 'bank' | 'cash' | 'credit' | 'asset' | 'liability';
export type CatType = 'exp' | 'inc';
export type Status = 'none' | 'clr' | 'rec';

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  institution: string;
  opening: number;
  sort: number;
  /** ISO 4217 code; the account's amounts are in this currency. */
  currency: string;
}

export interface Category {
  id: number;
  name: string;
  parent: number;
  type: CatType;
  color: string | null;
}

export interface Payee {
  id: number;
  name: string;
  defCat: number;
  defPay: string;
}

export interface Split {
  cat: number;
  memo: string;
  amount: number;
}

export interface Txn {
  id: number;
  date: string;
  acc: number;
  /** Destination account for transfers, else 0. */
  xfer: number;
  amount: number;
  /** For transfers: what arrived in `xfer`, in its currency. Null means -amount. */
  xamt: number | null;
  pay: string;
  info: string;
  payee: number;
  cat: number;
  memo: string;
  tags: string[];
  status: Status;
  splits: Split[] | null;
}

export interface LedgerData {
  accounts: Account[];
  cats: Category[];
  payees: Payee[];
  txns: Txn[];
}

export const ACCOUNT_TYPES: [AccountType, string][] = [
  ['bank', 'Bank'],
  ['cash', 'Cash'],
  ['credit', 'Credit card'],
  ['asset', 'Assets'],
  ['liability', 'Liabilities'],
];

export const PAYMENTS = [
  'None', 'Credit card', 'Check', 'Cash', 'Bank transfer', 'Debit card', 'Standing order',
  'Electronic payment', 'Deposit', 'FI fee', 'Direct debit',
];

export const PALETTE = [
  'oklch(0.56 0.09 155)', 'oklch(0.72 0.13 80)', 'oklch(0.6 0.11 245)', 'oklch(0.64 0.14 30)',
  'oklch(0.58 0.13 305)', 'oklch(0.65 0.1 195)', 'oklch(0.7 0.12 120)', 'oklch(0.62 0.12 355)',
];
export const OTHER = 'oklch(0.62 0.01 150)';

/** Offered on first run so a new account isn't empty. */
export const STARTER_CATEGORIES: { name: string; type: CatType; color: string; subs: string[] }[] = [
  { name: 'Housing', type: 'exp', color: PALETTE[0], subs: ['Rent', 'Electricity', 'Internet & phone', 'Household'] },
  { name: 'Food', type: 'exp', color: PALETTE[1], subs: ['Groceries', 'Dining out', 'Coffee'] },
  { name: 'Transport', type: 'exp', color: PALETTE[2], subs: ['Fuel', 'Rideshare', 'Car insurance'] },
  { name: 'Shopping', type: 'exp', color: PALETTE[3], subs: ['General', 'Clothing', 'Electronics'] },
  { name: 'Entertainment', type: 'exp', color: PALETTE[4], subs: ['Subscriptions', 'Events'] },
  { name: 'Health', type: 'exp', color: PALETTE[5], subs: ['Pharmacy', 'Fitness'] },
  { name: 'Bank & fees', type: 'exp', color: OTHER, subs: ['Fees'] },
  { name: 'Salary', type: 'inc', color: PALETTE[0], subs: [] },
  { name: 'Interest', type: 'inc', color: PALETTE[6], subs: [] },
  { name: 'Refunds', type: 'inc', color: PALETTE[5], subs: [] },
  { name: 'Gifts', type: 'inc', color: PALETTE[1], subs: [] },
];

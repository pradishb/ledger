// All Supabase reads and writes. The app loads the whole (single-user) data set
// into one cached query; every write invalidates it.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { STARTER_CATEGORIES } from '../lib/types';
import type { Account, AccountType, CatType, Category, LedgerData, Payee, Txn } from '../lib/types';

export const LEDGER_KEY = ['ledger'] as const;

const PAGE = 1000; // PostgREST's default max rows per request

async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

interface AccountRow { id: number; name: string; type: AccountType; institution: string; opening_cents: number; sort: number; currency: string; hidden: boolean }
interface CategoryRow { id: number; name: string; parent_id: number | null; type: CatType; color: string | null }
interface PayeeRow { id: number; name: string; default_category_id: number | null; default_payment: string }
interface SplitRow { position: number; category_id: number; memo: string; amount_cents: number }
interface TxnRow {
  id: number; date: string; account_id: number; transfer_account_id: number | null; amount_cents: number;
  transfer_amount_cents: number | null;
  payment: string; info: string; payee_id: number | null; category_id: number | null; memo: string;
  tags: string[]; transaction_splits: SplitRow[];
}

export async function fetchLedger(): Promise<LedgerData> {
  const [accounts, cats, payees, txns] = await Promise.all([
    fetchAll<AccountRow>((a, b) => supabase.from('accounts').select('id,name,type,institution,opening_cents,sort,currency,hidden').order('sort').order('id').range(a, b)),
    fetchAll<CategoryRow>((a, b) => supabase.from('categories').select('id,name,parent_id,type,color').order('id').range(a, b)),
    fetchAll<PayeeRow>((a, b) => supabase.from('payees').select('id,name,default_category_id,default_payment').order('id').range(a, b)),
    fetchAll<TxnRow>((a, b) =>
      supabase.from('transactions')
        .select('id,date,account_id,transfer_account_id,amount_cents,transfer_amount_cents,payment,info,payee_id,category_id,memo,tags,transaction_splits(position,category_id,memo,amount_cents)')
        .order('id').range(a, b)),
  ]);
  return {
    accounts: accounts.map((r): Account => ({
      id: r.id, name: r.name, type: r.type, institution: r.institution, opening: Number(r.opening_cents), sort: r.sort, currency: r.currency, hidden: !!r.hidden,
    })),
    cats: cats.map((r): Category => ({ id: r.id, name: r.name, parent: r.parent_id ?? 0, type: r.type, color: r.color })),
    payees: payees.map((r): Payee => ({ id: r.id, name: r.name, defCat: r.default_category_id ?? 0, defPay: r.default_payment })),
    txns: txns.map((r): Txn => ({
      id: r.id, date: r.date, acc: r.account_id, xfer: r.transfer_account_id ?? 0, amount: Number(r.amount_cents),
      xamt: r.transfer_amount_cents == null ? null : Number(r.transfer_amount_cents),
      pay: r.payment, info: r.info, payee: r.payee_id ?? 0, cat: r.category_id ?? 0, memo: r.memo,
      tags: r.tags ?? [],
      splits: r.transaction_splits?.length
        ? [...r.transaction_splits].sort((x, y) => x.position - y.position)
            .map(s => ({ cat: s.category_id, memo: s.memo, amount: Number(s.amount_cents) }))
        : null,
    })),
  };
}

const check = <T extends { error: unknown }>(res: T) => {
  if (res.error) throw res.error;
  return res;
};

export interface TxnPayload {
  id: number | null;
  date: string;
  account_id: number;
  transfer_account_id: number | null;
  amount_cents: number;
  transfer_amount_cents: number | null;
  payment: string;
  info: string;
  payee_id: number | null;
  category_id: number | null;
  memo: string;
  tags: string[];
  splits: { category_id: number; memo: string; amount_cents: number }[];
}

export const api = {
  saveTxn: async (p: TxnPayload) => check(await supabase.rpc('save_transaction', { p })).data as number,
  deleteTxn: async (id: number) => void check(await supabase.from('transactions').delete().eq('id', id)),

  addAccount: async (a: Omit<Account, 'id' | 'sort' | 'hidden'>) =>
    void check(await supabase.from('accounts').insert({
      name: a.name, type: a.type, institution: a.institution, opening_cents: a.opening, currency: a.currency,
    })),
  setAccountHidden: async ({ id, hidden }: { id: number; hidden: boolean }) =>
    void check(await supabase.from('accounts').update({ hidden }).eq('id', id)),
  /** One change applied to several accounts at once. Currency is deliberately not editable. */
  updateAccounts: async ({ ids, patch }: { ids: number[]; patch: { hidden?: boolean; type?: AccountType; institution?: string } }) =>
    void check(await supabase.from('accounts').update(patch).in('id', ids)),

  addCategory: async (c: { name: string; parent: number; type: CatType; color: string | null }) =>
    void check(await supabase.from('categories').insert({ name: c.name, parent_id: c.parent || null, type: c.type, color: c.color })),
  deleteCategory: async (id: number) => void check(await supabase.from('categories').delete().eq('id', id)),

  addPayee: async (name: string) => void check(await supabase.from('payees').insert({ name })),
  updatePayee: async ({ id, defCat, defPay }: { id: number; defCat?: number; defPay?: string }) =>
    void check(await supabase.from('payees').update({
      ...(defCat !== undefined && { default_category_id: defCat || null }),
      ...(defPay !== undefined && { default_payment: defPay }),
    }).eq('id', id)),
  deletePayee: async (id: number) => void check(await supabase.from('payees').delete().eq('id', id)),

  seedCategories: async () => {
    const { data } = check(await supabase.from('categories')
      .insert(STARTER_CATEGORIES.map(c => ({ name: c.name, type: c.type, color: c.color })))
      .select('id,name'));
    const ids = new Map((data ?? []).map(r => [r.name as string, r.id as number]));
    const subs = STARTER_CATEGORIES.flatMap(c => c.subs.map(name => ({ name, type: c.type, parent_id: ids.get(c.name) })));
    check(await supabase.from('categories').insert(subs));
  },
};

/** A mutation that refreshes the ledger when it succeeds. */
export function useLedgerMutation<A, R>(fn: (arg: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: LEDGER_KEY }),
  });
}

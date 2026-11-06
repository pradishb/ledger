import { useState } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation, type TxnPayload } from '../data/api';
import { centsOr0, centsToInput, currencySymbol, errorMessage, fmt, parseMoney } from '../lib/format';
import { PAYMENTS } from '../lib/types';
import type { Account, CatType, Txn } from '../lib/types';
import type { Index } from '../lib/ledger';
import { Seg, SheetDialog } from './common';

type TxnType = CatType | 'xfer';
interface Line { cat: string; memo: string; amount: string }

/** Form state: everything is a string, as the inputs hold it. */
export interface Draft {
  id: number;
  type: TxnType;
  date: string;
  amount: string;
  /** Transfers between currencies: what arrived in `xfer`. */
  xamount: string;
  acc: string;
  xfer: string;
  pay: string;
  info: string;
  payee: string;
  cat: string;
  memo: string;
  tags: string;
  split: boolean;
  splits: Line[];
}

const blankLines = (): Line[] => [{ cat: '0', memo: '', amount: '' }, { cat: '0', memo: '', amount: '' }];
const otherAccount = (accounts: Account[], acc: string) => String(accounts.find(a => String(a.id) !== acc)?.id ?? 0);

export function blankDraft(accounts: Account[], today: string, base: Partial<Draft> = {}, curAcc = 0): Draft {
  const acc = base.acc ?? String(curAcc || accounts[0]?.id || 0);
  return {
    id: 0, type: 'exp', date: today, amount: '', xamount: '', acc, xfer: otherAccount(accounts, acc), pay: 'None', info: '',
    payee: '0', cat: '0', memo: '', tags: '', split: false, splits: blankLines(),
    ...base,
  };
}

export function draftFromTxn(t: Txn, accounts: Account[]): Draft {
  return {
    id: t.id,
    type: t.xfer ? 'xfer' : t.amount < 0 ? 'exp' : 'inc',
    date: t.date,
    amount: centsToInput(t.amount),
    xamount: t.xamt == null ? '' : centsToInput(t.xamt),
    acc: String(t.acc),
    xfer: t.xfer ? String(t.xfer) : otherAccount(accounts, String(t.acc)),
    pay: t.pay, info: t.info, payee: String(t.payee), cat: String(t.cat), memo: t.memo,
    tags: t.tags.join(', '),
    split: !!t.splits,
    splits: t.splits ? t.splits.map(s => ({ cat: String(s.cat), memo: s.memo, amount: centsToInput(s.amount) })) : blankLines(),
  };
}

function catOptions(idx: Index, type: CatType | null, blank: string) {
  const o = [{ v: '0', l: blank }];
  for (const c of idx.tops.filter(c => !type || c.type === type)) {
    o.push({ v: String(c.id), l: c.name });
    for (const s of idx.subsOf(c.id)) o.push({ v: String(s.id), l: '    ' + s.name });
  }
  return o;
}

/** A transfer between accounts in different currencies, which needs the amount received too. */
const isCross = (d: Draft, idx: Index) => d.type === 'xfer' && !!+d.xfer && idx.accCur(+d.acc) !== idx.accCur(+d.xfer);

/** Validate the form and build the RPC payload, or return an error message. */
function toPayload(d: Draft, idx: Index): TxnPayload | string {
  const isX = d.type === 'xfer', sign = d.type === 'inc' ? 1 : -1;
  if (!d.date) return 'Pick a date.';
  if (!+d.acc) return 'Choose an account.';
  let amount: number;
  let splits: TxnPayload['splits'] = [];
  if (!isX && d.split) {
    const lines = d.splits.filter(l => l.cat !== '0' || centsOr0(l.amount));
    if (lines.length < 2) return 'A split needs at least two lines.';
    if (lines.some(l => l.cat === '0')) return 'Each split line needs a category.';
    if (lines.some(l => !(parseMoney(l.amount) > 0))) return 'Each split line needs an amount greater than zero.';
    splits = lines.map(l => ({ category_id: +l.cat, memo: l.memo.trim(), amount_cents: sign * parseMoney(l.amount) }));
    amount = splits.reduce((a, l) => a + l.amount_cents, 0);
  } else {
    const a = parseMoney(d.amount);
    if (!(a > 0)) return 'Enter an amount greater than zero.';
    amount = sign * a;
    if (isX && (!+d.xfer || d.xfer === d.acc)) return 'Choose two different accounts for a transfer.';
  }
  let xamt: number | null = null;
  if (isCross(d, idx)) {
    xamt = parseMoney(d.xamount);
    if (!(xamt > 0)) return 'Enter the amount received.';
  }
  return {
    id: d.id || null,
    date: d.date,
    account_id: +d.acc,
    transfer_account_id: isX ? +d.xfer : null,
    amount_cents: amount,
    transfer_amount_cents: xamt,
    payment: d.pay,
    info: d.info.trim(),
    payee_id: isX || d.payee === '0' ? null : +d.payee,
    category_id: isX || d.split || d.cat === '0' ? null : +d.cat,
    memo: d.memo.trim(),
    tags: d.tags.split(',').map(x => x.trim()).filter(Boolean),
    splits: isX ? [] : splits,
  };
}

export function TxnModal({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { data, idx, today, online, toast } = useLedger();
  const [d, setDraft] = useState(initial);
  const [err, setErr] = useState('');
  const saveM = useLedgerMutation(api.saveTxn);
  const delM = useLedgerMutation(api.deleteTxn);
  const busy = saveM.isPending || delM.isPending;

  const setD = (patch: Partial<Draft>) => { setDraft(x => ({ ...x, ...patch })); setErr(''); };
  const isX = d.type === 'xfer';
  const split = !isX && d.split;
  const splitSum = d.splits.reduce((a, l) => a + centsOr0(l.amount), 0);
  const catOpts = catOptions(idx, d.type === 'xfer' ? null : d.type, '— No category —');
  // Hidden accounts aren't offered, except one this transaction already uses.
  const accounts = data.accounts.filter(a => !a.hidden || String(a.id) === initial.acc || String(a.id) === initial.xfer);
  const cur = idx.accCur(+d.acc);
  const cross = isCross(d, idx);
  const xcur = idx.accCur(+d.xfer);
  // Suggested amount received, at today's rate.
  const conv = cross && parseMoney(d.amount) > 0 ? idx.convert(parseMoney(d.amount), cur, xcur) : null;
  const est = conv === null ? '' : centsToInput(conv);

  const updLine = (i: number, patch: Partial<Line>) => setD({ splits: d.splits.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const removeLine = (i: number) => setD({
    splits: d.splits.length > 2 ? d.splits.filter((_, j) => j !== i) : d.splits.map((x, j) => (j === i ? { cat: '0', memo: '', amount: '' } : x)),
  });

  const onPayee = (val: string) => setD({ payee: val });

  async function save(keep: boolean) {
    const p = toPayload(d, idx);
    if (typeof p === 'string') return setErr(p);
    // What it was before, so Undo can put it back (or, for a new one, delete it).
    const before = d.id ? data.txns.find(t => t.id === d.id) : undefined;
    try {
      const id = await saveM.mutateAsync(p);
      toast(d.id ? 'Transaction updated' : 'Transaction added',
        before ? () => api.restoreTxns({ txns: [before], keepId: true }) : id ? () => api.deleteTxn(id) : undefined);
      if (keep) setDraft(blankDraft(accounts, today, { type: d.type, date: d.date, acc: d.acc, pay: d.pay }));
      else onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  async function del() {
    if (!confirm('Delete this transaction?')) return;
    const before = data.txns.find(t => t.id === d.id);
    try {
      await delM.mutateAsync(d.id);
      toast('Transaction deleted', before && (() => api.restoreTxns({ txns: [before], keepId: false })));
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <SheetDialog title={d.id ? 'Edit transaction' : 'New transaction'} onClose={onClose} onSubmit={() => { if (!busy && online) save(false); }}
      head={<Seg className="md" value={d.type}
        options={[['exp', 'Expense'], ['inc', 'Income'], ['xfer', 'Transfer']] as const}
        onChange={k => setD({ type: k, cat: '0', xfer: d.xfer === d.acc ? otherAccount(accounts, d.acc) : d.xfer })} />}
      foot={<>
        {d.id > 0 && <button type="button" className="btn danger" onClick={del} disabled={busy || !online}>Delete</button>}
        <div className="spacer" />
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        {!d.id && <button type="button" className="btn" onClick={() => save(true)} disabled={busy || !online}>Save and add another</button>}
        <button className="btn-primary" disabled={busy || !online}>Save</button>
      </>}>
          <div className="form-grid">
            <label className="field">Date
              <input className="input" type="date" value={d.date} onChange={e => setD({ date: e.target.value })} />
            </label>
            <label className="field">{split ? 'Amount (sum of splits)' : 'Amount'}
              <div className={`amount-box${split ? ' ro' : ''}`}>
                <span>{d.type === 'inc' ? '+' : '−'}{currencySymbol(cur)}</span>
                <input value={split ? (splitSum / 100).toFixed(2) : d.amount} readOnly={split}
                  onChange={e => setD({ amount: e.target.value })} placeholder="0.00" inputMode="decimal" autoFocus={!d.id} />
              </div>
            </label>
            <label className="field">{isX ? 'From account' : 'Account'}
              <select className="select" value={d.acc} onChange={e => {
                const a = e.target.value;
                setD({ acc: a, xfer: d.xfer === a ? otherAccount(accounts, a) : d.xfer });
              }}>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {isX ? (
              <label className="field">To account
                <select className="select" value={d.xfer} onChange={e => setD({ xfer: e.target.value })}>
                  {accounts.filter(a => String(a.id) !== d.acc).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            ) : (
              <label className="field">Payee
                <select className="select" value={d.payee} onChange={e => onPayee(e.target.value)}>
                  <option value="0">— No payee —</option>
                  {[...data.payees].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
            {cross && (
              <label className="field">Amount received
                <div className="amount-box">
                  <span>+{currencySymbol(xcur)}</span>
                  <input value={d.xamount} onChange={e => setD({ xamount: e.target.value })}
                    placeholder={est || '0.00'} inputMode="decimal" />
                </div>
              </label>
            )}
            <label className="field">Payment
              <select className="select" value={d.pay} onChange={e => setD({ pay: e.target.value })}>
                {PAYMENTS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="field">Info / check no.
              <input className="input" value={d.info} onChange={e => setD({ info: e.target.value })} placeholder="Optional reference" />
            </label>

            {!isX && (
              <div className="field full">
                <div className="cat-head">
                  <span>Category</span>
                  <button type="button" className="link" onClick={() => setD({
                    split: !d.split,
                    splits: !d.split && d.cat !== '0' && d.splits.every(l => l.cat === '0')
                      ? [{ cat: d.cat, memo: '', amount: d.amount }, { cat: '0', memo: '', amount: '' }]
                      : d.splits,
                  })}>
                    {d.split ? 'Use a single category' : 'Split across categories'}
                  </button>
                </div>
                {!split ? (
                  <select className="select" value={d.cat} onChange={e => setD({ cat: e.target.value })}>
                    {catOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                ) : (
                  <div className="split-box">
                    {d.splits.map((l, i) => (
                      <div className="split-line" key={i}>
                        <select className="select" value={l.cat} onChange={e => updLine(i, { cat: e.target.value })}>
                          {catOpts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                        <input className="input" value={l.memo} onChange={e => updLine(i, { memo: e.target.value })} placeholder="Memo" />
                        <input className="input amt" value={l.amount} onChange={e => updLine(i, { amount: e.target.value })} placeholder="0.00" inputMode="decimal" />
                        <button type="button" className="x" onClick={() => removeLine(i)} title="Remove line">×</button>
                      </div>
                    ))}
                    <div className="split-foot">
                      <button type="button" className="link" style={{ fontWeight: 500 }} onClick={() => setD({ splits: [...d.splits, { cat: '0', memo: '', amount: '' }] })}>+ Add line</button>
                      <span>{d.splits.filter(l => centsOr0(l.amount) > 0).length} lines · {fmt(splitSum, cur)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <label className="field full">Memo
              <input className="input" value={d.memo} onChange={e => setD({ memo: e.target.value })} />
            </label>
            <label className="field full">Tags
              <input className="input" value={d.tags} onChange={e => setD({ tags: e.target.value })} placeholder="Comma separated, e.g. work, vacation" />
            </label>
          </div>
          {err && <div className="err">{err}</div>}
          {!online && <div className="err">You're offline. Changes can't be saved until you reconnect.</div>}
    </SheetDialog>
  );
}


// Import into one account: Superwallet's on-chain token transfers (Alchemy's alchemy_getAssetTransfers) and
// card payments (Superwallet's /v2/transactions/), pasted as JSON, and bank statements chosen as .xls/.xlsx/.csv
// files. Every entry becomes a preview row, you choose what each one is, then save.
import { useMemo, useState } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation, type TxnPayload } from '../data/api';
import { Header } from '../components/common';
import { errorMessage, fmt } from '../lib/format';
import { ymd } from '../lib/dates';
import { amountFor, type Index } from '../lib/ledger';
import type { Txn } from '../lib/types';
import { UploadIcon } from 'lucide-react';
import { Dropzone, DropzoneContent, DropzoneEmptyState } from '@/components/kibo-ui/dropzone';
import { readStatement, type Statement, type StatementRow } from '../lib/statement';

/** One entry from an export, whatever its source. */
interface Item {
  key: string;
  /** Saved in Info; an entry whose ref is already there was imported before. */
  ref: string;
  time: number;
  dir: 'in' | 'out';
  /** Amount in the export's currency (USD for both sources), in cents. */
  cents: number;
  currency: string;
  /** Fees charged on top, in cents (card payments), or null when the fee is a share of the amount (token transfers). */
  fixedFee: number | null;
  feeNote: string;
  /** Rows with the same group (address or merchant) and direction follow each other's choices. */
  group: string;
  label: string;
  memo: string;
  /** Shown as tags beside the counterparty. */
  notes: string[];
  /** Why it can't be imported (a failed payment), or ''. */
  blocked: string;
  /** Starts unticked (a pending payment that may still change). */
  offByDefault: boolean;
  /** The address of a token transfer, for working out which wallet the export is for. */
  from?: string;
  to?: string;
}

interface Row {
  include: boolean;
  /** 'c:<category id>', 'x:<account id>' for a transfer, or '' while undecided. */
  what: string;
  /** Percent of the amount sent that was a fee, e.g. "2.1"; token transfers out only. */
  fee: string;
  payee: string;
  memo: string;
  /** For each field copied from another row, that row's key: it keeps following that row until edited here. */
  src: Partial<Record<Follow, string>>;
}
type Follow = 'what' | 'fee' | 'payee';

/** Stablecoins worth a dollar, so their amounts can go straight into a USD account. */
const DOLLARS = ['USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'TUSD', 'USDP'];

const cents = (v: unknown) => Math.round(Number(v || 0) * 100);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** The day it happened where you are. */
const localDate = (ms: number) => { const d = new Date(ms); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

/** One or more JSON documents pasted one after another (say, several pages of a list). */
function parseDocs(text: string): unknown[] {
  try { return [JSON.parse(text)]; } catch { /* several documents, split below */ }
  const docs: unknown[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') { if (!depth++) start = i; }
    else if (c === '}' || c === ']') { if (!--depth) docs.push(JSON.parse(text.slice(start, i + 1))); }
  }
  if (!docs.length) JSON.parse(text); // throws the real parse error
  return docs;
}

/** Every token transfer and card payment anywhere in the pasted JSON, newest first, each once. */
function parseItems(text: string): Item[] {
  const out = new Map<string, Item>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    // A token transfer (Alchemy). Direction is set once the wallet address is known.
    if (typeof o.hash === 'string' && typeof o.from === 'string' && typeof o.to === 'string' && o.value != null) {
      const key = String(o.uniqueId ?? `${o.hash}:${o.from}:${o.to}:${o.value}`);
      const asset = String(o.asset ?? '');
      out.set(key, {
        key, ref: o.hash, time: Date.parse(String((o.metadata as { blockTimestamp?: string } | undefined)?.blockTimestamp ?? '')) || 0,
        dir: 'out', cents: cents(o.value), currency: DOLLARS.includes(asset.toUpperCase()) ? 'USD' : asset, fixedFee: null, feeNote: '',
        group: '', label: '', memo: '', notes: [], blocked: '', offByDefault: false, from: o.from.toLowerCase(), to: o.to.toLowerCase(),
      });
      return;
    }
    // A card payment (Superwallet /v2/transactions/): charged in USD, with a card fee and a cross-border fee on top.
    if (typeof o.tradeNo === 'string' && o.authorizedAmount != null) {
      const merchant = String(o.merchantName ?? '').replace(/\s*\(APPLE\)\s*$/, '').trim();
      const fee = cents(o.fee), xb = cents(o.crossBoardFee);
      const local = o.currency && o.currency !== o.authorizedCurrency ? ` · ${o.currency} ${Number(o.amount).toLocaleString()}` : '';
      out.set(o.tradeNo, {
        key: o.tradeNo, ref: o.tradeNo, time: Number(o.transactionTime) || 0, dir: 'out',
        cents: cents(o.authorizedAmount), currency: String(o.authorizedCurrency ?? 'USD'),
        fixedFee: fee + xb, feeNote: [fee && `card fee ${(fee / 100).toFixed(2)}`, xb && `cross-border ${(xb / 100).toFixed(2)}`].filter(Boolean).join(' + '),
        group: merchant.toLowerCase(), label: merchant, memo: merchant + local,
        notes: o.status === 'AUTHORIZED' ? ['Pending'] : [],
        blocked: o.status === 'FAILED' ? 'Failed' : '',
        offByDefault: o.status === 'AUTHORIZED',
      });
      return;
    }
    Object.values(o).forEach(walk);
  };
  parseDocs(text).forEach(walk);
  return [...out.values()].sort((a, b) => b.time - a.time);
}

/** Spreadsheet statements, by type and extension (a browser may give an .xls no type at all). */
const STATEMENT_TYPES = {
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/csv': ['.csv'],
};

/** Account numbers and other long digit runs at the end of a bank's detail text: "…//PA/0999524531844005". */
const tail = (s: string) => s.replace(/\s*\/+\s*\d{8,}\s*$/, '').trim();

/**
 * Rows of a bank statement as entries. A row with the same ref, detail and direction as a bigger one is its
 * service fee (a bill payment and its 4.00 charge); a reversal ("REV-<ref>-…") and the row it undoes start unticked.
 */
export function statementItems(st: Statement): Item[] {
  const currency = st.currency || 'NPR';
  const bySame = new Map<string, StatementRow[]>();
  for (const r of st.rows) {
    const k = `${r.date}|${r.ref}|${r.detail}`;
    if (r.ref && r.debit) bySame.set(k, [...(bySame.get(k) ?? []), r]);
  }
  const feeOf = new Map<StatementRow, StatementRow>(), isFee = new Set<StatementRow>();
  for (const g of bySame.values()) {
    if (g.length !== 2) continue;
    const [big, small] = [...g].sort((a, b) => (b.debit + b.credit) - (a.debit + a.credit));
    if (small.debit + small.credit < big.debit + big.credit) { feeOf.set(big, small); isFee.add(small); }
  }
  const reversed = new Set(st.rows.map(r => r.detail.match(/^REV-([^-\s]+)-/i)?.[1]).filter(Boolean));
  const out: Item[] = [];
  const seen = new Map<string, number>();
  for (const r of st.rows) {
    if (isFee.has(r)) continue;
    const dir = r.debit ? 'out' : 'in';
    const amt = r.debit || r.credit, fee = feeOf.get(r);
    const feeAmt = fee ? fee.debit || fee.credit : 0;
    // The ref alone repeats (a dividend and its fee, interest and its tax), so the amount is part of what marks it imported.
    let ref = `${r.ref || r.date}:${dir === 'in' ? '+' : '-'}${(amt / 100).toFixed(2)}`;
    const n = seen.get(ref) ?? 0;
    seen.set(ref, n + 1);
    if (n) ref += `#${n + 1}`;
    const detail = tail(r.detail);
    // "Eating out,THE ARK PUB" is a QR payment: your remark, then the merchant. "ESEWA,138535719": a wallet top-up.
    const m = detail.match(/^(.*),([^,]+)$/);
    const label = m ? (/^\d+$/.test(m[2].trim()) ? m[1] : m[2]).trim() : detail;
    const isRev = /^REV-/i.test(r.detail), wasRev = reversed.has(r.ref);
    const [y, mo, d] = r.date.split('-').map(Number);
    out.push({
      key: ref, ref, time: new Date(y, mo - 1, d).getTime() + r.index, dir, cents: amt, currency,
      fixedFee: feeAmt, feeNote: fee ? `service charge ${(feeAmt / 100).toFixed(2)}` : '',
      // Same counterparty, ignoring ids that change every time (wallet transaction numbers). A "REF-…" payment
      // says nothing about who it went to, so it's on its own.
      group: /^REF-/i.test(detail) ? ref : detail.toLowerCase().replace(/[a-z0-9]*\d[a-z0-9]*/g, '#'),
      label: label || detail, memo: detail, notes: isRev ? ['Reversal'] : wasRev ? ['Reversed'] : [],
      blocked: '', offByDefault: isRev || wasRev,
    });
  }
  return out;
}

/** Days since 1970 for a yyyy-mm-dd date. */
const dayNo = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
/** How many days apart an entry and a transaction typed in by hand can be and still be the same one. */
const NEAR_DAYS = 3;

/**
 * Entries that look like they're already in the account, typed in by hand or imported from somewhere else
 * (so their Info doesn't say): a transaction there with the same amount, with or without the fee, within a
 * few days. Each transaction stands for one entry at most, the nearest date first.
 */
export function findEntered(list: Item[], txns: Txn[], acc: number) {
  const byAmount = new Map<number, Txn[]>();
  for (const t of txns) {
    if (t.acc !== acc && t.xfer !== acc) continue;
    const a = amountFor(t, acc);
    byAmount.set(a, [...(byAmount.get(a) ?? []), t]);
  }
  const pairs: { it: Item; t: Txn; gap: number }[] = [];
  for (const it of list) {
    const sign = it.dir === 'in' ? 1 : -1, day = dayNo(localDate(it.time));
    const amounts = new Set([it.cents, it.cents + (it.fixedFee ?? 0)]);
    for (const a of amounts) for (const t of byAmount.get(sign * a) ?? []) {
      const gap = Math.abs(dayNo(t.date) - day);
      if (gap <= NEAR_DAYS) pairs.push({ it, t, gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap);
  const found = new Map<string, Txn>(), used = new Set<number>();
  for (const { it, t } of pairs) {
    if (found.has(it.key) || used.has(t.id)) continue;
    found.set(it.key, t);
    used.add(t.id);
  }
  return found;
}

/** The address that's on every token transfer: the wallet the export is for. */
function ownAddress(list: Item[]) {
  const tx = list.filter(i => i.from);
  const n = new Map<string, number>();
  for (const t of tx) for (const a of new Set([t.from!, t.to!])) n.set(a, (n.get(a) ?? 0) + 1);
  return [...n].find(([, c]) => c === tx.length)?.[0] ?? '';
}

/** Split an amount sent into what arrived and the fee: 102.10 at 2.1% is 100.00 + 2.10. */
function splitFee(total: number, pct: number) {
  const base = pct > 0 ? Math.round(total / (1 + pct / 100)) : total;
  return { base, fee: total - base };
}

function whatOptions(idx: Index, accounts: { id: number; name: string }[], type: 'inc' | 'exp') {
  return (
    <>
      <option value="">Choose…</option>
      <optgroup label={type === 'inc' ? 'Income' : 'Expense'}>
        {idx.tops.filter(c => c.type === type).flatMap(c => [
          <option key={c.id} value={`c:${c.id}`}>{c.name}</option>,
          ...idx.subsOf(c.id).map(s => <option key={s.id} value={`c:${s.id}`}>{'    ' + s.name}</option>),
        ])}
      </optgroup>
      <optgroup label={type === 'inc' ? 'Transfer from' : 'Transfer to'}>
        {accounts.map(a => <option key={a.id} value={`x:${a.id}`}>{a.name}</option>)}
      </optgroup>
    </>
  );
}

export function Import() {
  const { data, idx, online, toast } = useLedger();
  const [text, setText] = useState('');
  /** Statement files chosen, by name, with what was read from each. */
  const [files, setFiles] = useState<{ file: File; name: string; items: Item[]; account: string; error: string }[]>([]);
  const [acc, setAcc] = useState('0');
  const [me, setMe] = useState('');
  const [rows, setRows] = useState<Record<string, Row>>({});
  const feeCatDefault = data.cats.find(c => /bank/i.test(c.name) && /charge|fee/i.test(c.name))?.id ?? 0;
  const [feeCat, setFeeCat] = useState(String(feeCatDefault));
  const [err, setErr] = useState('');
  const save = useLedgerMutation(async (list: TxnPayload[]) => {
    const ids: number[] = [];
    for (const p of list) ids.push(await api.saveTxn(p));
    return ids;
  });

  const parsed = useMemo(() => {
    if (!text.trim()) return { list: [] as Item[], error: '' };
    try { return { list: parseItems(text), error: '' }; } catch (e) { return { list: [], error: `Not valid JSON: ${errorMessage(e)}` }; }
  }, [text]);
  // Statements can overlap (one month, then the week after it): each entry once.
  const items = useMemo(() => {
    const all = new Map<string, Item>();
    for (const i of [...files.flatMap(f => f.items), ...parsed.list]) all.set(i.key, i);
    return [...all.values()].sort((a, b) => b.time - a.time);
  }, [files, parsed.list]);

  /** Read the statements dropped or chosen; they replace the ones before. */
  async function addFiles(list: File[]) {
    if (!list.length) return;
    const read = await Promise.all(list.map(async f => {
      try {
        const st = await readStatement(await f.arrayBuffer());
        return { file: f, name: f.name, items: statementItems(st), account: st.account, error: st.rows.length ? '' : 'no transactions in it' };
      } catch (e) {
        return { file: f, name: f.name, items: [], account: '', error: errorMessage(e) };
      }
    }));
    setFiles(read);
    setRows({});
    setErr('');
  }
  const hasTransfers = items.some(i => i.from);
  const wallet = (me || ownAddress(items)).toLowerCase();
  const account = idx.accMap.get(+acc);
  const cur = account?.currency ?? idx.disp;
  // Transfers only to accounts in the same currency, so no exchange rate is needed.
  const others = data.accounts.filter(a => a.id !== +acc && a.currency === cur && !a.hidden);
  const imported = new Set(data.txns.map(t => t.info).filter(Boolean));

  const resolved = items.map(i => {
    // Token transfers: in or out depending on which side the wallet is, grouped by the other address.
    const it: Item = i.from
      ? { ...i, dir: i.to === wallet ? 'in' : 'out', group: i.to === wallet ? i.from : i.to!, label: i.to === wallet ? i.from : i.to! }
      : i;
    if (it.from) it.memo = it.dir === 'in' ? `From ${short(it.label)}` : `To ${short(it.label)}`;
    return it;
  });
  const entered = account ? findEntered(resolved.filter(it => !imported.has(it.ref) && !it.blocked), data.txns, account.id) : new Map<string, Txn>();
  const view = resolved.map(it => {
    const done = imported.has(it.ref);
    const off = done || !!it.blocked;
    // A likely match is only a guess, so it starts unticked but can still be ticked.
    const dup = entered.get(it.key);
    const r: Row = rows[it.key] ?? { include: !off && !it.offByDefault && !dup, what: '', fee: '', payee: '0', memo: it.memo, src: {} };
    return { it, r, done, dup, off, odd: account ? it.currency !== cur : false };
  });

  // Editing a row changes only that row, except that rows with the same address or merchant which are still blank,
  // or were filled from this row, follow it (keystroke by keystroke in the fee box). Edit a follower and it's its own.
  function set(key: string, patch: Partial<Row>) {
    setErr('');
    setRows(prev => {
      const next = { ...prev };
      const row = view.find(v => v.it.key === key)!;
      const own = { ...row.r, ...prev[key] };
      const src = { ...own.src };
      for (const f of ['what', 'fee', 'payee'] as const) if (patch[f] !== undefined) delete src[f];
      next[key] = { ...own, ...patch, src };
      for (const v of view) {
        if (v.it.key === key || v.off || v.it.group !== row.it.group || v.it.dir !== row.it.dir) continue;
        const r = next[v.it.key] ?? v.r;
        const upd: Partial<Row> = {}, rsrc = { ...r.src };
        for (const f of ['what', 'fee', 'payee'] as const) {
          if (patch[f] === undefined) continue;
          const blank = r[f] === (f === 'payee' ? '0' : '');
          if ((blank && !rsrc[f]) || rsrc[f] === key) { upd[f] = patch[f]; rsrc[f] = key; }
        }
        next[v.it.key] = { ...r, ...upd, src: rsrc };
      }
      return next;
    });
  }

  /** The amount itself and the fee, for a row as currently set. */
  const amounts = (it: Item, r: Row) => {
    if (it.fixedFee !== null) return { base: it.cents, fee: it.fixedFee, note: it.feeNote };
    const pct = it.dir === 'out' ? parseFloat(r.fee) || 0 : 0;
    return { ...splitFee(it.cents, pct), note: `${pct}%` };
  };

  const chosen = view.filter(v => v.r.include && !v.off);

  async function submit() {
    if (!account) return setErr('Choose the account these belong to.');
    if (!chosen.length) return setErr('Nothing to import.');
    if (chosen.some(v => !v.r.what)) return setErr('Choose what each included row is.');
    const list: TxnPayload[] = [];
    for (const { it, r } of chosen) {
      const [kind, id] = [r.what[0], +r.what.slice(2)];
      const { base, fee, note } = amounts(it, r);
      if (fee && !+feeCat) return setErr('Choose a category for the fees.');
      const common = {
        id: null, date: localDate(it.time), transfer_amount_cents: null, payment: 'None', info: it.ref,
        memo: r.memo.trim(), tags: [], splits: [],
      };
      if (kind === 'x') {
        // An incoming transfer is recorded on the account it came from.
        list.push(it.dir === 'in'
          ? { ...common, account_id: id, transfer_account_id: account.id, amount_cents: -base, payee_id: null, category_id: null }
          : { ...common, account_id: account.id, transfer_account_id: id, amount_cents: -base, payee_id: null, category_id: null });
      } else {
        list.push({ ...common, account_id: account.id, transfer_account_id: null, amount_cents: it.dir === 'in' ? base : -base, payee_id: +r.payee || null, category_id: id });
      }
      if (fee) list.push({ ...common, account_id: account.id, transfer_account_id: null, amount_cents: -fee, payee_id: null, category_id: +feeCat, memo: `${common.memo ? common.memo + ' · ' : ''}fee (${note})` });
    }
    try {
      const ids = await save.mutateAsync(list);
      toast(`Imported ${list.length} transaction${list.length === 1 ? '' : 's'}`, () => api.deleteTxns(ids));
      setRows({});
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  const total = (dir: 'in' | 'out') => chosen.filter(v => v.it.dir === dir).reduce((a, v) => a + v.it.cents + (v.it.fixedFee ?? 0), 0);
  const count = (f: (v: (typeof view)[number]) => boolean) => view.filter(f).length;

  return (
    <>
      <Header title="Import" subtitle="Bank statements, Superwallet transfers and card payments" />
      <div className="content">
        <div className="stack" style={{ maxWidth: 1320 }}>
          <div className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Dropzone accept={STATEMENT_TYPES} maxFiles={10} onDrop={addFiles} onError={e => setErr(e.message)} src={files.length ? files.map(f => f.file) : undefined}>
              <DropzoneEmptyState>
                <div className="flex flex-col items-center justify-center">
                  <div className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <UploadIcon size={16} />
                  </div>
                  <p className="my-2 w-full truncate text-wrap font-medium text-sm">Upload bank statements</p>
                  <p className="w-full truncate text-wrap text-muted-foreground text-xs">Drag and drop or click to upload</p>
                  <p className="text-wrap text-muted-foreground text-xs">Accepts .xls, .xlsx and .csv. Choose several and rows they share are shown once.</p>
                </div>
              </DropzoneEmptyState>
              <DropzoneContent />
            </Dropzone>
            {err && !items.length && <div className="err">{err}</div>}
            {files.length > 0 && (
              <div className="muted" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {files.map(f => (
                  <span key={f.name}>
                    {f.name}: {f.error ? <span className="err" style={{ margin: 0 }}>{f.error}</span> : `${f.items.length} entries${f.account ? ` · account ${f.account}` : ''}`}
                    {' '}<button className="link" onClick={() => { setFiles(p => p.filter(x => x.name !== f.name)); setRows({}); }}>Remove</button>
                  </span>
                ))}
              </div>
            )}
            <label className="field">Paste the JSON (one response, or several one after another)
              <textarea className="input" style={{ height: 120, padding: 8, fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical' }}
                value={text} onChange={e => { setText(e.target.value); setRows({}); setErr(''); }} placeholder='{"success":true,"data":{"records":[…]}}' />
            </label>
            <div className="muted" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span>Where to get it: open Superwallet in the browser, open DevTools → Network, search for the request below, and copy its response.</span>
              <span>Wallet transfers: <code className="mono" style={{ userSelect: 'all' }}>https://bnb-mainnet.g.alchemy.com/v2/</code></span>
              <span>Card payments: <code className="mono" style={{ userSelect: 'all' }}>https://api.superwallet.xhype.io/v2/transactions/</code> (one response per page; paste them all)</span>
            </div>
            {parsed.error && <div className="err">{parsed.error}</div>}
            <div className="inline-form" style={{ padding: 0, border: 0 }}>
              <label className="field">Into account
                <select className="select" value={acc} onChange={e => { setAcc(e.target.value); setRows({}); }}>
                  <option value="0">Choose…</option>
                  {data.accounts.filter(a => !a.hidden).map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                </select>
              </label>
              {hasTransfers && (
                <label className="field">Wallet address
                  <input className="input mono" style={{ width: 380, fontSize: 12 }} value={me || wallet} onChange={e => setMe(e.target.value.trim())} placeholder="0x…" />
                </label>
              )}
              <label className="field">Fees go to
                <select className="select" value={feeCat} onChange={e => setFeeCat(e.target.value)}>
                  <option value="0">Choose…</option>
                  {idx.tops.filter(c => c.type === 'exp').flatMap(c => [c, ...idx.subsOf(c.id)]).map(c =>
                    <option key={c.id} value={c.id}>{c.parent ? '    ' + c.name : c.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          {items.length > 0 && (
            <div className="panel">
              <div className="scroll-x">
                <table className="tbl" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 30 }} />
                      <th style={{ width: 96 }}>Date</th>
                      <th>Counterparty</th>
                      <th className="r" style={{ width: 150 }}>Amount</th>
                      <th style={{ width: 220 }}>What it is</th>
                      {hasTransfers && <th style={{ width: 80 }}>Fee %</th>}
                      <th style={{ width: 160 }}>Payee</th>
                      <th style={{ width: 260 }}>Memo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.map(({ it, r, done, dup, off, odd }) => {
                      const { base, fee } = amounts(it, r);
                      const dim = off || !r.include;
                      return (
                        <tr key={it.key} style={{ opacity: dim ? 0.5 : 1 }}>
                          <td><input type="checkbox" checked={r.include && !off} disabled={off} onChange={e => set(it.key, { include: e.target.checked })} /></td>
                          <td className="small" style={{ whiteSpace: 'nowrap' }}>{it.time ? localDate(it.time) : '?'}</td>
                          <td className="small">
                            {it.from
                              ? <span className="mono" title={it.label}>{it.dir === 'in' ? '← ' : '→ '}{short(it.label)}</span>
                              : <span>{it.label}</span>}
                            {done && <span className="tag">Already imported</span>}
                            {dup && <span className="tag" title={`${dup.date} · ${fmt(Math.abs(amountFor(dup, +acc)), cur)}${dup.memo ? ` · ${dup.memo}` : ''}`}>Already in account?</span>}
                            {it.blocked && <span className="tag">{it.blocked}</span>}
                            {it.notes.map(n => <span key={n} className="tag">{n}</span>)}
                            {odd && <span className="tag" title={`Imported as ${cur} at face value`}>{it.currency}</span>}
                          </td>
                          <td className="num" style={{ color: it.dir === 'in' ? 'var(--inc)' : 'var(--out)' }}>
                            {it.dir === 'in' ? '+' : '−'}{fmt(it.cents + (it.fixedFee ?? 0), cur)}
                            {fee > 0 && <div className="muted" style={{ fontSize: 11 }}>{fmt(base, cur)} + {fmt(fee, cur)} fee</div>}
                          </td>
                          <td>
                            <select className="select sm" style={{ width: '100%' }} value={r.what} disabled={dim} onChange={e => set(it.key, { what: e.target.value })}>
                              {whatOptions(idx, others, it.dir === 'in' ? 'inc' : 'exp')}
                            </select>
                          </td>
                          {hasTransfers && (
                            <td>
                              {it.fixedFee === null && it.dir === 'out' && <input className="input sm" style={{ width: '100%' }} inputMode="decimal" placeholder="0" value={r.fee} disabled={dim}
                                onChange={e => set(it.key, { fee: e.target.value })} />}
                            </td>
                          )}
                          <td>
                            {!r.what.startsWith('x:') && (
                              <select className="select sm" style={{ width: '100%' }} value={r.payee} disabled={dim} onChange={e => set(it.key, { payee: e.target.value })}>
                                <option value="0">—</option>
                                {[...data.payees].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            )}
                          </td>
                          <td><input className="input sm" style={{ width: '100%' }} value={r.memo} disabled={dim} onChange={e => set(it.key, { memo: e.target.value })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="inline-form" style={{ borderTop: '1px solid var(--line)', borderBottom: 0 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {chosen.length} of {view.length} selected · in <b style={{ color: 'var(--inc)' }}>{fmt(total('in'), cur)}</b> · out <b style={{ color: 'var(--out)' }}>{fmt(total('out'), cur)}</b>
                  {count(v => v.done) > 0 && ` · ${count(v => v.done)} already imported`}
                  {count(v => !!v.dup) > 0 && ` · ${count(v => !!v.dup)} look already in the account (unticked; hover the tag to see the match)`}
                  {count(v => !!v.it.blocked) > 0 && ` · ${count(v => !!v.it.blocked)} failed`}
                </span>
                <div className="spacer" />
                {err && <span className="err" style={{ margin: 0 }}>{err}</span>}
                <button className="btn-primary" onClick={submit} disabled={!online || save.isPending || !chosen.length}>
                  Import {chosen.length || ''}
                </button>
              </div>
            </div>
          )}
          {!items.length && text.trim() && !parsed.error && <div className="panel"><div className="empty">No transfers or card payments found in that JSON.</div></div>}
        </div>
      </div>
    </>
  );
}

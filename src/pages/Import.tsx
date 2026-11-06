// Import exports from Superwallet into one account: on-chain token transfers (Alchemy's
// alchemy_getAssetTransfers) and card payments (Superwallet's /v2/transactions/). Paste one or more
// responses; every entry becomes a preview row, you choose what each one is, then save.
import { useMemo, useState } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation, type TxnPayload } from '../data/api';
import { Header } from '../components/common';
import { errorMessage, fmt } from '../lib/format';
import { ymd } from '../lib/dates';
import type { Index } from '../lib/ledger';

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
  const items = parsed.list;
  const hasTransfers = items.some(i => i.from);
  const wallet = (me || ownAddress(items)).toLowerCase();
  const account = idx.accMap.get(+acc);
  const cur = account?.currency ?? idx.disp;
  // Transfers only to accounts in the same currency, so no exchange rate is needed.
  const others = data.accounts.filter(a => a.id !== +acc && a.currency === cur && !a.hidden);
  const imported = new Set(data.txns.map(t => t.info).filter(Boolean));

  const view = items.map(i => {
    // Token transfers: in or out depending on which side the wallet is, grouped by the other address.
    const it: Item = i.from
      ? { ...i, dir: i.to === wallet ? 'in' : 'out', group: i.to === wallet ? i.from : i.to!, label: i.to === wallet ? i.from : i.to! }
      : i;
    if (it.from) it.memo = it.dir === 'in' ? `From ${short(it.label)}` : `To ${short(it.label)}`;
    const done = imported.has(it.ref);
    const off = done || !!it.blocked;
    const r: Row = rows[it.key] ?? { include: !off && !it.offByDefault, what: '', fee: '', payee: '0', memo: it.memo, src: {} };
    return { it, r, done, off, odd: account ? it.currency !== cur : false };
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
      <Header title="Import" subtitle="Superwallet transfers and card payments" />
      <div className="content">
        <div className="stack" style={{ maxWidth: 1320 }}>
          <div className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                    {view.map(({ it, r, done, off, odd }) => {
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

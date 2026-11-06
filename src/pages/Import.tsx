// Import on-chain token transfers (the JSON from Alchemy's alchemy_getAssetTransfers, one response or a
// batch) into one account. Every transfer becomes a preview row; you choose what each one is, then save.
import { useMemo, useState } from 'react';
import { useLedger } from '../data/context';
import { api, useLedgerMutation, type TxnPayload } from '../data/api';
import { Header } from '../components/common';
import { errorMessage, fmt } from '../lib/format';
import { ymd } from '../lib/dates';
import type { Index } from '../lib/ledger';

interface Transfer { key: string; hash: string; from: string; to: string; value: number; asset: string; time: string }

interface Row {
  include: boolean;
  /** 'c:<category id>', 'x:<account id>' for a transfer, or '' while undecided. */
  what: string;
  /** Percent of the amount sent that was a fee, e.g. "2.1"; outgoing only. */
  fee: string;
  payee: string;
  memo: string;
  /** For each field copied from another row, that row's key: it keeps following that row until edited here. */
  src: Partial<Record<Follow, string>>;
}
type Follow = 'what' | 'fee' | 'payee';

/** Stablecoins worth a dollar, so their amounts can go straight into a USD account. */
const DOLLARS = ['USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'TUSD', 'USDP'];

/** Every transfer object anywhere in the pasted JSON, newest first, each once. */
function parseTransfers(text: string): Transfer[] {
  const out = new Map<string, Transfer>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.hash === 'string' && typeof o.from === 'string' && typeof o.to === 'string' && o.value != null) {
      const key = String(o.uniqueId ?? `${o.hash}:${o.from}:${o.to}:${o.value}`);
      out.set(key, {
        key, hash: o.hash, from: o.from.toLowerCase(), to: o.to.toLowerCase(), value: Number(o.value),
        asset: String(o.asset ?? ''), time: String((o.metadata as { blockTimestamp?: string } | undefined)?.blockTimestamp ?? ''),
      });
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(JSON.parse(text));
  return [...out.values()].sort((a, b) => (a.time < b.time ? 1 : -1));
}

/** The address that's on every transfer: the wallet the export is for. */
function ownAddress(list: Transfer[]) {
  const n = new Map<string, number>();
  for (const t of list) for (const a of new Set([t.from, t.to])) n.set(a, (n.get(a) ?? 0) + 1);
  return [...n].find(([, c]) => c === list.length)?.[0] ?? '';
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
/** The day it happened where you are. */
const localDate = (iso: string) => { const d = new Date(iso); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

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
    if (!text.trim()) return { list: [] as Transfer[], error: '' };
    try { return { list: parseTransfers(text), error: '' }; } catch (e) { return { list: [], error: `Not valid JSON: ${errorMessage(e)}` }; }
  }, [text]);
  const transfers = parsed.list;
  const wallet = (me || ownAddress(transfers)).toLowerCase();
  const account = idx.accMap.get(+acc);
  const cur = account?.currency ?? idx.disp;
  // Transfers only to accounts in the same currency, so no exchange rate is needed.
  const others = data.accounts.filter(a => a.id !== +acc && a.currency === cur && !a.hidden);
  const imported = new Set(data.txns.map(t => t.info).filter(Boolean));

  const view = transfers.map(t => {
    const dir: 'in' | 'out' = t.to === wallet ? 'in' : 'out';
    const done = imported.has(t.hash);
    const r: Row = rows[t.key] ?? { include: !done, what: '', fee: '', payee: '0', memo: dir === 'in' ? `From ${short(t.from)}` : `To ${short(t.to)}`, src: {} };
    const other = dir === 'in' ? t.from : t.to;
    return { t, r, dir, done, other, cents: Math.round(t.value * 100), odd: cur === 'USD' && !DOLLARS.includes(t.asset.toUpperCase()) };
  });

  // Editing a row changes only that row, except that rows to and from the same address which are still blank,
  // or were filled from this row, follow it (keystroke by keystroke in the fee box). Edit a follower and it's its own.
  function set(key: string, patch: Partial<Row>) {
    setErr('');
    setRows(prev => {
      const next = { ...prev };
      const row = view.find(v => v.t.key === key)!;
      const own = { ...row.r, ...prev[key] };
      const src = { ...own.src };
      for (const f of ['what', 'fee', 'payee'] as const) if (patch[f] !== undefined) delete src[f];
      next[key] = { ...own, ...patch, src };
      for (const v of view) {
        if (v.t.key === key || v.done || v.other !== row.other || v.dir !== row.dir) continue;
        const r = next[v.t.key] ?? v.r;
        const upd: Partial<Row> = {}, rsrc = { ...r.src };
        for (const f of ['what', 'fee', 'payee'] as const) {
          if (patch[f] === undefined) continue;
          const blank = r[f] === (f === 'payee' ? '0' : '');
          if ((blank && !rsrc[f]) || rsrc[f] === key) { upd[f] = patch[f]; rsrc[f] = key; }
        }
        next[v.t.key] = { ...r, ...upd, src: rsrc };
      }
      return next;
    });
  }

  const chosen = view.filter(v => v.r.include && !v.done);

  async function submit() {
    if (!account) return setErr('Choose the account these belong to.');
    if (!chosen.length) return setErr('Nothing to import.');
    if (chosen.some(v => !v.r.what)) return setErr('Choose what each included row is.');
    const list: TxnPayload[] = [];
    for (const v of chosen) {
      const [kind, id] = [v.r.what[0], +v.r.what.slice(2)];
      const pct = v.dir === 'out' ? parseFloat(v.r.fee) || 0 : 0;
      if (pct && !+feeCat) return setErr('Choose a category for the fees.');
      const { base, fee } = splitFee(v.cents, pct);
      const common = {
        id: null, date: localDate(v.t.time), transfer_amount_cents: null, payment: 'None', info: v.t.hash,
        memo: v.r.memo.trim(), tags: [], splits: [],
      };
      if (kind === 'x') {
        // An incoming transfer is recorded on the account it came from.
        list.push(v.dir === 'in'
          ? { ...common, account_id: id, transfer_account_id: account.id, amount_cents: -base, payee_id: null, category_id: null }
          : { ...common, account_id: account.id, transfer_account_id: id, amount_cents: -base, payee_id: null, category_id: null });
      } else {
        list.push({ ...common, account_id: account.id, transfer_account_id: null, amount_cents: v.dir === 'in' ? base : -base, payee_id: +v.r.payee || null, category_id: id });
      }
      if (fee) list.push({ ...common, account_id: account.id, transfer_account_id: null, amount_cents: -fee, payee_id: null, category_id: +feeCat, memo: `${common.memo ? common.memo + ' · ' : ''}fee (${pct}%)` });
    }
    try {
      const ids = await save.mutateAsync(list);
      toast(`Imported ${list.length} transaction${list.length === 1 ? '' : 's'}`, () => api.deleteTxns(ids));
      setRows({});
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  const total = (dir: 'in' | 'out') => chosen.filter(v => v.dir === dir).reduce((a, v) => a + v.cents, 0);

  return (
    <>
      <Header title="Import" subtitle="Token transfers from a wallet export" />
      <div className="content">
        <div className="stack" style={{ maxWidth: 1320 }}>
          <div className="panel" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label className="field">Paste the JSON (alchemy_getAssetTransfers, one response or a batch)
              <textarea className="input" style={{ height: 120, padding: 8, fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical' }}
                value={text} onChange={e => { setText(e.target.value); setRows({}); setErr(''); }} placeholder='[{"jsonrpc":"2.0","result":{"transfers":[…]}}]' />
            </label>
            <div className="muted" style={{ fontSize: 12 }}>
              Where to get it: open Superwallet in the browser, open DevTools → Network, and search for{' '}
              <code className="mono" style={{ userSelect: 'all' }}>https://bnb-mainnet.g.alchemy.com/v2/</code>.
              Copy the response of that request and paste it here.
            </div>
            {parsed.error && <div className="err">{parsed.error}</div>}
            <div className="inline-form" style={{ padding: 0, border: 0 }}>
              <label className="field">Into account
                <select className="select" value={acc} onChange={e => { setAcc(e.target.value); setRows({}); }}>
                  <option value="0">Choose…</option>
                  {data.accounts.filter(a => !a.hidden).map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                </select>
              </label>
              <label className="field">Wallet address
                <input className="input mono" style={{ width: 380, fontSize: 12 }} value={me || wallet} onChange={e => setMe(e.target.value.trim())} placeholder="0x…" />
              </label>
              <label className="field">Fees go to
                <select className="select" value={feeCat} onChange={e => setFeeCat(e.target.value)}>
                  <option value="0">Choose…</option>
                  {idx.tops.filter(c => c.type === 'exp').flatMap(c => [c, ...idx.subsOf(c.id)]).map(c =>
                    <option key={c.id} value={c.id}>{c.parent ? '    ' + c.name : c.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          {transfers.length > 0 && (
            <div className="panel">
              <div className="scroll-x">
                <table className="tbl" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 30 }} />
                      <th style={{ width: 96 }}>Date</th>
                      <th>Counterparty</th>
                      <th className="r" style={{ width: 120 }}>Amount</th>
                      <th style={{ width: 220 }}>What it is</th>
                      <th style={{ width: 80 }}>Fee %</th>
                      <th style={{ width: 160 }}>Payee</th>
                      <th style={{ width: 240 }}>Memo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.map(v => {
                      const pct = v.dir === 'out' ? parseFloat(v.r.fee) || 0 : 0;
                      const { base, fee } = splitFee(v.cents, pct);
                      const off = v.done || !v.r.include;
                      return (
                        <tr key={v.t.key} style={{ opacity: off ? 0.5 : 1 }}>
                          <td><input type="checkbox" checked={v.r.include && !v.done} disabled={v.done} onChange={e => set(v.t.key, { include: e.target.checked })} /></td>
                          <td className="small" style={{ whiteSpace: 'nowrap' }}>{v.t.time ? localDate(v.t.time) : '?'}</td>
                          <td className="small">
                            <span className="mono" title={v.other}>{v.dir === 'in' ? '← ' : '→ '}{short(v.other)}</span>
                            {v.done && <span className="tag">Already imported</span>}
                            {v.odd && <span className="tag" title={`Imported as ${cur} at face value`}>{v.t.asset}</span>}
                          </td>
                          <td className="num" style={{ color: v.dir === 'in' ? 'var(--inc)' : 'var(--out)' }}>
                            {v.dir === 'in' ? '+' : '−'}{fmt(v.cents, cur)}
                            {fee > 0 && <div className="muted" style={{ fontSize: 11 }}>{fmt(base, cur)} + {fmt(fee, cur)} fee</div>}
                          </td>
                          <td>
                            <select className="select sm" style={{ width: '100%' }} value={v.r.what} disabled={off} onChange={e => set(v.t.key, { what: e.target.value })}>
                              {whatOptions(idx, others, v.dir === 'in' ? 'inc' : 'exp')}
                            </select>
                          </td>
                          <td>
                            {v.dir === 'out' && <input className="input sm" style={{ width: '100%' }} inputMode="decimal" placeholder="0" value={v.r.fee} disabled={off}
                              onChange={e => set(v.t.key, { fee: e.target.value })} />}
                          </td>
                          <td>
                            {!v.r.what.startsWith('x:') && (
                              <select className="select sm" style={{ width: '100%' }} value={v.r.payee} disabled={off} onChange={e => set(v.t.key, { payee: e.target.value })}>
                                <option value="0">—</option>
                                {[...data.payees].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            )}
                          </td>
                          <td><input className="input sm" style={{ width: '100%' }} value={v.r.memo} disabled={off} onChange={e => set(v.t.key, { memo: e.target.value })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="inline-form" style={{ borderTop: '1px solid var(--line)', borderBottom: 0 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {chosen.length} of {view.length} selected · in <b style={{ color: 'var(--inc)' }}>{fmt(total('in'), cur)}</b> · out <b style={{ color: 'var(--out)' }}>{fmt(total('out'), cur)}</b>
                  {view.some(v => v.done) && ` · ${view.filter(v => v.done).length} already imported`}
                </span>
                <div className="spacer" />
                {err && <span className="err" style={{ margin: 0 }}>{err}</span>}
                <button className="btn-primary" onClick={submit} disabled={!online || save.isPending || !chosen.length}>
                  Import {chosen.length || ''}
                </button>
              </div>
            </div>
          )}
          {!transfers.length && text.trim() && !parsed.error && <div className="panel"><div className="empty">No transfers found in that JSON.</div></div>}
        </div>
      </div>
    </>
  );
}

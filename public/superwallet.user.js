// ==UserScript==
// @name         Superwallet → Ledger sync
// @namespace    https://ledger.pradish.com.np/
// @version      2.1.0
// @description  Syncs your Superwallet card and wallet into Ledger (payments, fees, top-ups, transfers, balances), with a preview before anything changes.
// @match        https://superwallet.xhype.io/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @downloadURL  https://raw.githubusercontent.com/pradishb/ledger/main/public/superwallet.user.js
// @updateURL    https://raw.githubusercontent.com/pradishb/ledger/main/public/superwallet.user.js
// ==/UserScript==

// How it works
// 1. While you use Superwallet, the script keeps a copy of the responses Superwallet loads:
//    card payments and card top-ups (Cards page), on-chain deposits (Dashboard) and the card
//    balance. Nothing leaves the page until you press Sync.
// 2. Sync signs in to Ledger as you (once; the session is kept in Tampermonkey's storage, out of
//    the page's reach), reads your Superwallet card account and shows every change it would make.
// 3. Apply writes them. Every row is matched by Superwallet's own id (Ledger's Info field), so
//    syncing again never duplicates anything. Categories, payees and memos you set are kept.
//
// Rules
// - A payment is two rows, like the Import page makes: the amount, and its card + cross-border fee.
// - Pending payments carry the tag "pending" until they settle; then the tag goes and the amount
//   becomes the settled one.
// - A cancelled hold (VOID) keeps only its fees; a failed payment has no rows.
// - Top-ups are matched to the transfer from your Superwallet wallet; missing ones are added.
// - Superwallet's bank holds extra money while payments are pending, and that hold never appears
//   in its transaction list. So the sync keeps one "bank hold" row: Superwallet's balance minus
//   everything else. Your card balance in Ledger then always equals Superwallet's, and the row
//   disappears once the hold is released. Old hand-made rows with an Info of "hold:…" are removed.
// - The wallet (the "Superwallet" account): every USDT/USDC transfer the Dashboard loads is matched
//   by its transaction hash. A top-up to the card is a transfer to the card account plus a row for
//   Superwallet's fee; other transfers are income or spending, with the category last used for that
//   address. The wallet's balance is checked against what it holds on BNB Chain; a difference means
//   some history isn't loaded, so it's reported rather than papered over.

(function () {
  'use strict';

  const SUPABASE_URL = 'https://gziwnkbcxsrbxfnyovge.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_pr20nDp1uX5ubtAF1J6Yjg_a1faSqWB';
  const HOLD_INFO = 'superwallet:hold';
  const FEE_CATEGORY = 'Banking Charges';
  const DOLLARS = ['USDT', 'USDC', 'BUSD', 'DAI', 'FDUSD', 'TUSD', 'USDP'];
  const BSC_RPC = 'https://bsc-dataseed.bnbchain.org';
  // Dollar tokens on BNB Chain, checked for the wallet balance even when no transfer of them is loaded.
  const BSC_DOLLARS = { '0x55d398326f99059ff775485246999027b3197955': 18, '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 18 };

  // ---------------------------------------------------------------------------------------------
  // Planning: pure functions, no browser needed (they're also run by the tests in Node).

  const cents = v => Math.round(parseFloat(v || 0) * 100);
  const pad = n => String(n).padStart(2, '0');
  const localDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const money = c => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
  const isFeeRow = r => /· fee \(/.test(r.memo || '');
  const merchantOf = name => String(name || '').replace(/\s*\(APPLE\)\s*$/, '').trim();
  const short = a => `${a.slice(0, 6)}…${a.slice(-4)}`;
  /** Token amounts in wei (18 decimals) as cents: "21000000000000000000" is 2100. */
  const weiCents = v => { try { return Number((BigInt(v || 0) + 5000000000000000n) / 10000000000000000n); } catch { return cents(v); } };

  /** Superwallet's responses, sorted out by what they contain. */
  function collect(docs) {
    const sw = { payments: new Map(), paymentsTotal: 0, deposits: new Map(), depositsTotal: 0, onchain: new Map(), balance: null, transfers: new Map(), wallet: '' };
    const walk = (v, total) => {
      if (Array.isArray(v)) return v.forEach(x => walk(x, total));
      if (!v || typeof v !== 'object') return;
      if (v.balanceInfo && v.balanceInfo.amount != null) {
        sw.balance = { cents: cents(v.balanceInfo.amount), cardNo: v.balanceInfo.cardNo || v.cardNo || '', currency: v.balanceInfo.currency || 'USD' };
      }
      if (Array.isArray(v.transfers)) {
        for (const t of v.transfers) {
          if (!t || typeof t.hash !== 'string' || typeof t.from !== 'string' || typeof t.to !== 'string' || t.value == null) continue;
          sw.transfers.set(String(t.uniqueId || `${t.hash}:${t.from}:${t.to}:${t.value}`), { ...t, from: t.from.toLowerCase(), to: t.to.toLowerCase() });
        }
        return;
      }
      if (Array.isArray(v.records)) {
        const t = Number(v.total) || 0;
        for (const r of v.records) {
          if (!r || typeof r !== 'object') continue;
          if (typeof r.tradeNo === 'string' && r.authorizedAmount != null) {
            sw.payments.set(r.tradeNo, r); sw.paymentsTotal = Math.max(sw.paymentsTotal, t);
          } else if (r.type === 'DEPOSIT' && r.orderNo && r.receivedAmount != null) {
            sw.deposits.set(r.orderNo, r); sw.depositsTotal = Math.max(sw.depositsTotal, t);
          } else if (r.type === 'ONCHAIN_DEPOSIT' && r.id != null) {
            sw.onchain.set(String(r.id), r);
          }
        }
        return;
      }
      for (const x of Object.values(v)) walk(x, total);
    };
    docs.forEach(d => walk(d));
    // Several cards: keep the one whose balance was loaded.
    const card = sw.balance && sw.balance.cardNo;
    if (card) for (const m of [sw.payments, sw.deposits]) for (const [k, r] of m) if (r.cardNo && r.cardNo !== card) m.delete(k);
    // The wallet's own address: the sender of a known top-up, else the one address in every transfer.
    const hashes = new Set([...sw.onchain.values()].map(o => String(o.reportedTxHash || '').toLowerCase()));
    const list = [...sw.transfers.values()];
    sw.wallet = (list.find(t => hashes.has(t.hash.toLowerCase())) || {}).from || '';
    if (!sw.wallet && list.length > 1) {
      const n = new Map();
      for (const t of list) for (const a of new Set([t.from, t.to])) n.set(a, (n.get(a) || 0) + 1);
      sw.wallet = ([...n].find(([, c]) => c === list.length) || [''])[0];
    }
    return sw;
  }

  /** How a row changes the card account's balance. */
  function effect(r, card) {
    if (r.account_id === card) return Number(r.amount_cents);
    if (r.transfer_account_id === card) return r.transfer_amount_cents != null ? Number(r.transfer_amount_cents) : -Number(r.amount_cents);
    return 0;
  }

  /**
   * The changes that make Ledger's card account match Superwallet.
   * ledger: { card, wallet, opening, rows, categories }, rows being every transaction that
   * touches the card account. Returns { ops, notes, warnings, balance }.
   */
  function plan(sw, ledger, now = Date.now()) {
    const { card, wallet } = ledger;
    const rows = ledger.rows.map(r => ({ ...r, tags: r.tags || [] }));
    const ops = [], warnings = [], notes = [];
    const touched = new Set(); // ledger row ids this sync accounts for
    const byInfo = new Map();
    for (const r of rows) if (r.info) byInfo.set(r.info, [...(byInfo.get(r.info) || []), r]);

    const feeCat = (ledger.categories.find(c => c.name === FEE_CATEGORY) || {}).id
      ?? mostCommon(rows.filter(isFeeRow).map(r => r.category_id));
    if (!feeCat) warnings.push(`No "${FEE_CATEGORY}" category: fee rows will have no category.`);
    // New payments take the category last used for the same merchant on this card.
    const catOf = new Map();
    for (const r of [...rows].sort((a, b) => a.date < b.date ? -1 : 1)) {
      if (r.account_id === card && !r.transfer_account_id && !isFeeRow(r) && r.category_id) catOf.set((r.memo || '').split(' · ')[0], r.category_id);
    }

    const insert = (row, why) => ops.push({ kind: 'insert', row: { account_id: card, transfer_account_id: null, transfer_amount_cents: null, category_id: null, tags: [], ...row }, why });
    const want = (existing, row, why) => {
      if (!existing) return insert(row, why);
      touched.add(existing.id);
      const patch = {};
      if (Number(existing.amount_cents) !== row.amount_cents) patch.amount_cents = row.amount_cents;
      const pending = row.tags.includes('pending'), has = existing.tags.includes('pending');
      if (pending !== has) patch.tags = pending ? [...existing.tags, 'pending'] : existing.tags.filter(t => t !== 'pending');
      if (Object.keys(patch).length) ops.push({ kind: 'update', id: existing.id, patch, before: existing, why: whyUpdate(existing, patch) });
    };
    const drop = (r, why) => { touched.add(r.id); ops.push({ kind: 'delete', id: r.id, before: r, why }); };

    // Card payments.
    const voided = new Set([...sw.payments.values()].filter(p => p.type === 'VOID' && p.status === 'SUCCESS' && p.originTradeNo).map(p => p.originTradeNo));
    const unknownTypes = new Set();
    for (const p of sw.payments.values()) {
      const mine = (byInfo.get(p.tradeNo) || []).filter(r => r.account_id === card);
      const payRows = mine.filter(r => !isFeeRow(r)), feeRows = mine.filter(isFeeRow);
      const merchant = merchantOf(p.merchantName);
      const local = p.currency && p.currency !== p.authorizedCurrency ? ` · ${p.currency} ${Number(p.amount).toLocaleString('en-US')}` : '';
      const memo = merchant + local;
      const fee = cents(p.fee), xb = cents(p.crossBoardFee);
      const feeNote = [fee && `card fee ${(fee / 100).toFixed(2)}`, xb && `cross-border ${(xb / 100).toFixed(2)}`].filter(Boolean).join(' + ');
      const date = localDate(Number(p.transactionTime) || now);
      const ok = p.status === 'SUCCESS' || p.status === 'AUTHORIZED';
      const pending = p.status === 'AUTHORIZED';
      if (p.type !== 'AUTH' && p.type !== 'VOID') { unknownTypes.add(p.type); mine.forEach(r => touched.add(r.id)); continue; }
      if (payRows.length > 1 || feeRows.length > 1) {
        warnings.push(`${memo}: Ledger has ${mine.length} rows for this payment; left as they are.`);
        mine.forEach(r => touched.add(r.id));
        continue;
      }
      // The amount itself: only for a payment that went through and wasn't cancelled.
      const settled = p.status === 'SUCCESS' && cents(p.settleAmount) > 0 ? cents(p.settleAmount) : cents(p.authorizedAmount);
      const payWanted = p.type === 'AUTH' && ok && !voided.has(p.tradeNo);
      if (payWanted && (settled > 0 || payRows[0])) {
        want(payRows[0], { date, amount_cents: -settled, memo, info: p.tradeNo, category_id: catOf.get(merchant) || null, tags: pending ? ['pending'] : [] },
          pending ? 'new pending payment' : 'new payment');
      } else if (payRows[0]) {
        drop(payRows[0], p.status === 'FAILED' ? 'payment failed' : voided.has(p.tradeNo) ? 'hold was cancelled (void)' : `payment is ${p.status}`);
      }
      // Its fees: kept for a cancelled hold too, since they were charged.
      const feeWanted = ok && fee + xb > 0;
      if (feeWanted) {
        want(feeRows[0], { date, amount_cents: -(fee + xb), memo: `${memo} · fee (${feeNote})`, info: p.tradeNo, category_id: feeCat || null, tags: pending ? ['pending'] : [] },
          p.type === 'VOID' ? 'fee for cancelling a hold' : 'fees of a new payment');
      } else if (feeRows[0]) {
        drop(feeRows[0], 'no fee was charged');
      }
    }
    if (unknownTypes.size) warnings.push(`Skipped Superwallet records of an unknown type: ${[...unknownTypes].join(', ')}.`);

    // Top-ups into the card.
    const used = new Set();
    for (const d of sw.deposits.values()) {
      if (d.status !== 'SUCCESS') continue;
      const amt = cents(d.receivedAmount);
      const m = /^dep-\d+-0*(\d+)$/.exec(d.merchantOrderNo || '');
      const hash = m && sw.onchain.get(m[1]) && sw.onchain.get(m[1]).reportedTxHash;
      const date = localDate(Number(d.transactionTime) || now);
      const into = r => effect(r, card) > 0;
      let match = (hash && (byInfo.get(hash) || []).find(into)) || (byInfo.get(d.orderNo) || []).find(into);
      if (!match) {
        // Entered some other way: same amount within three days, not claimed by another top-up.
        const t = Number(d.transactionTime);
        match = rows.find(r => into(r) && !used.has(r.id) && !touched.has(r.id) && effect(r, card) === amt
          && Math.abs(Date.parse(r.date) - t) < 3.5 * 864e5 && !(r.info && sw.payments.has(r.info)));
      }
      if (match) {
        used.add(match.id); touched.add(match.id);
        if (effect(match, card) !== amt) warnings.push(`Top-up ${money(amt)} on ${date} is ${money(effect(match, card))} in Ledger; left as it is.`);
        continue;
      }
      if (hash && wallet) {
        // Labelled like the wallet's other rows when its transfer is loaded; the wallet sync adds the fee.
        const t = [...sw.transfers.values()].find(x => x.hash.toLowerCase() === hash.toLowerCase());
        insert({ account_id: wallet, transfer_account_id: card, amount_cents: -amt, date, info: hash, memo: t ? `To ${short(t.to)}` : 'Top-up to Superwallet card' }, 'missing top-up from the wallet');
      } else {
        const what = /open card/i.test(d.remark || '') ? 'card opening top-up' : d.sourceOfTx === 'dashboard' ? 'top-up from the Superwallet dashboard' : 'card top-up';
        insert({ amount_cents: amt, date, info: d.orderNo, memo: `Superwallet ${what}` }, `missing ${what}`);
      }
    }

    // Hand-made hold rows are replaced by the automatic one.
    for (const r of rows) if (r.account_id === card && /^hold:/.test(r.info || '')) drop(r, 'old hand-made hold, replaced by the automatic one');

    // The bank hold: whatever is left between Superwallet's balance and everything else.
    const holdRows = rows.filter(r => r.info === HOLD_INFO && r.account_id === card);
    const after = applyTo(rows, ops, card).filter(r => r.info !== HOLD_INFO);
    const ledgerCents = Number(ledger.opening || 0) + after.reduce((s, r) => s + effect(r, card), 0);
    let balance = null;
    if (sw.balance) {
      const gap = sw.balance.cents - ledgerCents;
      balance = { superwallet: sw.balance.cents, records: ledgerCents, gap };
      holdRows.slice(1).forEach(r => drop(r, 'duplicate hold row'));
      const memo = gap < 0
        ? 'Bank hold while payments are pending (released when they settle)'
        : 'Superwallet shows more than its transactions add up to';
      if (gap === 0) { if (holdRows[0]) drop(holdRows[0], 'hold released'); }
      else if (!holdRows[0]) insert({ amount_cents: gap, date: localDate(now), info: HOLD_INFO, memo, tags: ['pending'] }, 'difference to Superwallet\'s balance');
      else {
        touched.add(holdRows[0].id);
        const patch = {};
        // Dated when the amount last changed, so a sync where nothing moved changes nothing.
        if (Number(holdRows[0].amount_cents) !== gap) Object.assign(patch, { amount_cents: gap, date: localDate(now) });
        if (holdRows[0].memo !== memo) patch.memo = memo;
        if (Object.keys(patch).length) ops.push({ kind: 'update', id: holdRows[0].id, patch, before: holdRows[0], why: 'hold changed' });
      }
    } else {
      warnings.push('Card balance not loaded yet, so the bank hold can\'t be worked out. Open the Cards page.');
    }

    // Completeness.
    if (sw.paymentsTotal && sw.payments.size < sw.paymentsTotal) {
      warnings.push(`Only ${sw.payments.size} of ${sw.paymentsTotal} card payments are loaded. Page through all of them on the Cards page for a complete sync; until then the hold row also covers the missing ones.`);
    }
    if (sw.depositsTotal && sw.deposits.size < sw.depositsTotal) warnings.push(`Only ${sw.deposits.size} of ${sw.depositsTotal} card top-ups are loaded.`);
    const strays = rows.filter(r => r.account_id === card && !touched.has(r.id) && r.info !== HOLD_INFO && !r.transfer_account_id && !sw.payments.has(r.info));
    if (strays.length) notes.push(`${strays.length} other row${strays.length > 1 ? 's' : ''} on the card account aren't from Superwallet's lists and are left alone.`);
    return { ops, notes, warnings, balance };
  }

  /**
   * The changes that make Ledger's wallet account match the wallet's transfers. Plan it on the rows as
   * they'll be after the card's changes, so a top-up the card sync adds isn't added twice.
   * chainCents: what the wallet holds on BNB Chain, in cents (null if unknown).
   */
  function planWallet(sw, ledger, chainCents = null, now = Date.now()) {
    const { card, wallet } = ledger;
    const ops = [], warnings = [], notes = [];
    if (!wallet) return { ops, notes, warnings: ['No Superwallet wallet account in Ledger.'], balance: null, address: '' };
    const rows = ledger.rows.map(r => ({ ...r, tags: r.tags || [] }));
    const me = (sw.wallet || ledger.walletAddress || '').toLowerCase();
    if (!sw.transfers.size) {
      warnings.push('No wallet transfers loaded yet. Open the Dashboard so the wallet can be synced.');
    } else if (!me) {
      warnings.push("Couldn't tell which address is the wallet's. Open the Dashboard as well as the Cards page.");
    }
    const byInfo = new Map();
    for (const r of rows) if (r.info) byInfo.set(r.info.toLowerCase(), [...(byInfo.get(r.info.toLowerCase()) || []), r]);
    const feeCat = (ledger.categories.find(c => c.name === FEE_CATEGORY) || {}).id ?? null;
    // Last category used with each address, from memos like "From 0xb80a…5fef".
    const catOf = new Map();
    for (const r of [...rows].sort((a, b) => a.date < b.date ? -1 : 1)) {
      if (r.account_id === wallet && !r.transfer_account_id && !isFeeRow(r) && r.category_id) catOf.set((r.memo || '').split(/[,·]/)[0].trim(), r.category_id);
    }
    const onchain = new Map([...sw.onchain.values()].map(o => [String(o.reportedTxHash || '').toLowerCase(), o]));
    const depositAddrs = new Set([...sw.transfers.values()].filter(t => onchain.has(t.hash.toLowerCase())).map(t => t.to));
    const insert = (row, why) => ops.push({ kind: 'insert', row: { account_id: wallet, transfer_account_id: null, transfer_amount_cents: null, category_id: null, tags: [], ...row }, why });
    const skipped = new Set();
    if (me) for (const t of sw.transfers.values()) {
      const asset = String(t.asset || '').toUpperCase();
      const dir = t.to === me && t.from !== me ? 'in' : t.from === me && t.to !== me ? 'out' : null;
      if (!dir) continue;
      if (!DOLLARS.includes(asset)) { skipped.add(asset || 'unknown'); continue; }
      const amt = cents(t.value);
      if (!amt) continue;
      const hash = t.hash.toLowerCase();
      const date = localDate(Date.parse((t.metadata || {}).blockTimestamp) || now);
      const mine = byInfo.get(hash) || [];
      const net = mine.reduce((s, r) => s + effect(r, wallet), 0);
      const o = onchain.get(hash);
      if (dir === 'out' && o && o.cardId && card) {
        // A card top-up: what reached the card, plus Superwallet's fee.
        const fee = weiCents(o.businessFeeAmount);
        const toCard = mine.find(r => r.account_id === wallet && r.transfer_account_id === card);
        const feeRow = mine.find(r => r.account_id === wallet && isFeeRow(r));
        if (!toCard) insert({ transfer_account_id: card, amount_cents: -(amt - fee), date, info: t.hash, memo: `To ${short(t.to)}` }, 'top-up to the card');
        if (fee && !feeRow) {
          const pct = Math.round(fee / (amt - fee) * 1000) / 10;
          insert({ amount_cents: -fee, date, info: t.hash, category_id: feeCat, memo: `To ${short(t.to)} · fee (${pct}%)` }, "Superwallet's top-up fee");
        }
        continue;
      }
      const want = dir === 'in' ? amt : -amt;
      if (mine.length) {
        if (net !== want) warnings.push(`Transfer ${short(t.hash)} on ${date} is ${money(want)} on-chain but ${money(net)} in Ledger; left as it is.`);
        continue;
      }
      if (dir === 'out' && depositAddrs.has(t.to) && !o) {
        warnings.push(`A top-up of ${money(amt)} on ${date} isn't in the loaded deposit list, so its fee isn't known. Open the Dashboard's deposit history.`);
        continue;
      }
      const memo = dir === 'in' ? `From ${short(t.from)}` : `To ${short(t.to)}`;
      const sub = o && !o.cardId ? `${memo}, Superwallet ${o.tierId ? 'card subscription' : 'payment'}` : memo;
      insert({ amount_cents: want, date, info: t.hash, memo: sub, category_id: o && !o.cardId ? feeCat : catOf.get(memo) || null }, dir === 'in' ? 'money in' : 'money out');
    }
    if (skipped.size) notes.push(`Transfers of ${[...skipped].join(', ')} aren't dollars and are left out.`);

    const after = applyTo(rows, ops);
    const ledgerCents = Number(ledger.walletOpening || 0) + after.reduce((s, r) => s + effect(r, wallet), 0);
    const balance = chainCents == null ? null : { chain: chainCents, ledger: ledgerCents, gap: chainCents - ledgerCents };
    if (balance && balance.gap) {
      warnings.push(`Ledger's wallet is ${money(Math.abs(balance.gap))} ${balance.gap > 0 ? 'below' : 'above'} what the wallet holds on-chain. Some transfers may not be loaded: open the Dashboard and scroll through its history, then sync again.`);
    } else if (chainCents == null && me) {
      warnings.push("Couldn't read the wallet's on-chain balance, so it isn't checked.");
    }
    return { ops, notes, warnings, balance, address: me };
  }

  function mostCommon(xs) {
    const n = new Map();
    for (const x of xs) if (x) n.set(x, (n.get(x) || 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  function whyUpdate(r, patch) {
    const bits = [];
    if ('amount_cents' in patch) bits.push(`amount ${money(Number(r.amount_cents))} → ${money(patch.amount_cents)}`);
    if ('tags' in patch) bits.push(patch.tags.includes('pending') ? 'marked pending' : 'settled');
    return bits.join(', ');
  }

  /** Rows as they'd be after the ops (inserts get no id). */
  function applyTo(rows, ops) {
    const out = new Map(rows.map(r => [r.id, { ...r }]));
    let n = 0;
    for (const op of ops) {
      if (op.kind === 'delete') out.delete(op.id);
      else if (op.kind === 'update') Object.assign(out.get(op.id), op.patch);
      else out.set(`new${n++}`, op.row);
    }
    return [...out.values()];
  }

  const Sync = { collect, plan, planWallet, effect, applyTo, localDate, money, weiCents, HOLD_INFO, BSC_DOLLARS };
  if (typeof module === 'object' && module.exports) { module.exports = Sync; return; }

  // ---------------------------------------------------------------------------------------------
  // Capturing Superwallet's responses.

  const page = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (page.top !== page.self) return;
  const docs = new Map(); // response text -> parsed, so repeats count once
  const alchemy = new Map(); // Alchemy transfer responses, for the Copy fallback

  async function bodyText(body) {
    try {
      body = await body;
      if (body == null) return '';
      if (typeof body === 'string') return body;
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
      if (body instanceof Blob) return await body.text();
      if (body instanceof URLSearchParams) return body.toString();
    } catch { /* unreadable */ }
    return '';
  }

  function keep(url, text, body) {
    if (!text) return;
    let json; try { json = JSON.parse(text); } catch { return; }
    if (/^https:\/\/api\.superwallet\.xhype\.io\//.test(url)) {
      if (!docs.has(text)) { docs.set(text, json); render(); }
    } else if (/alchemy\.com/.test(url) && /alchemy_getAssetTransfers/.test(body)) {
      if (!alchemy.has(text)) { alchemy.set(text, json); render(); }
    }
  }
  const interesting = url => /^https:\/\/api\.superwallet\.xhype\.io\//.test(url) || /^https:\/\/[^/]*alchemy\.com\//.test(url);

  const realFetch = page.fetch;
  page.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input && input.url) || '';
    const body = init && 'body' in init ? init.body : input instanceof Request ? input.clone().text().catch(() => '') : '';
    const result = realFetch.apply(this, arguments);
    if (interesting(url)) result.then(async res => keep(url, await res.clone().text(), await bodyText(body)), () => {});
    return result;
  };
  const XHR = page.XMLHttpRequest.prototype, realOpen = XHR.open, realSend = XHR.send;
  XHR.open = function (method, url) { this.__swUrl = String(url); return realOpen.apply(this, arguments); };
  XHR.send = function (body) {
    const url = new URL(this.__swUrl || '', page.location.href).href;
    if (interesting(url)) {
      this.addEventListener('load', async () => {
        const text = this.responseType === '' || this.responseType === 'text' ? this.responseText
          : this.responseType === 'json' ? JSON.stringify(this.response) : '';
        keep(url, text, await bodyText(body));
      });
    }
    return realSend.apply(this, arguments);
  };

  // ---------------------------------------------------------------------------------------------
  // Ledger: a Supabase session kept in Tampermonkey's storage (not the page's).

  const nativeFetch = realFetch.bind(page);
  async function supa(path, { method = 'GET', body, token, headers = {} } = {}) {
    const res = await nativeFetch(SUPABASE_URL + path, {
      method,
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && (data.message || data.msg || data.error_description || data.error)) || `Ledger request failed (${res.status})`);
    return data;
  }

  async function session() {
    const s = GM_getValue('ledgerSession', null);
    if (!s) return null;
    if (s.expires_at * 1000 > Date.now() + 60e3) return s;
    try { return remember(await supa('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } })); }
    catch { GM_deleteValue('ledgerSession'); return null; }
  }
  const remember = s => { GM_setValue('ledgerSession', { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, email: s.user && s.user.email }); return GM_getValue('ledgerSession'); };
  const signIn = async (email, password) => remember(await supa('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }));

  async function loadLedger(token) {
    const accounts = await supa('/rest/v1/accounts?select=id,name,currency,opening_cents', { token });
    const sw = accounts.filter(a => /superwallet/i.test(a.name));
    const card = GM_getValue('cardAccount', null) ?? (sw.find(a => /card/i.test(a.name)) || {}).id;
    const wallet = GM_getValue('walletAccount', null) ?? (sw.find(a => !/card/i.test(a.name)) || {}).id ?? null;
    const acc = accounts.find(a => a.id === card);
    if (!acc) throw new Error('No Superwallet card account in Ledger (an account named like "Superwallet - Card").');
    const wacc = accounts.find(a => a.id === wallet);
    const ids = [card, wallet].filter(Boolean);
    const [rows, categories] = await Promise.all([
      supa(`/rest/v1/transactions?select=id,date,account_id,transfer_account_id,amount_cents,transfer_amount_cents,info,memo,category_id,tags&or=(${ids.map(i => `account_id.eq.${i},transfer_account_id.eq.${i}`).join(',')})&order=id`, { token }),
      supa('/rest/v1/categories?select=id,name', { token }),
    ]);
    return { card, wallet, opening: acc.opening_cents, account: acc, walletAccount: wacc || null, walletOpening: wacc ? wacc.opening_cents : 0,
      walletAddress: GM_getValue('walletAddress', ''), rows, categories };
  }

  /** USDT/USDC the wallet holds on BNB Chain, in cents; null if it can't be read. */
  async function chainBalance(address, sw) {
    if (!address) return null;
    const tokens = { ...BSC_DOLLARS };
    for (const t of sw.transfers.values()) {
      const c = t.rawContract || {};
      if (c.address && DOLLARS.includes(String(t.asset || '').toUpperCase())) tokens[c.address.toLowerCase()] = parseInt(c.decimal || '0x12', 16) || 18;
    }
    try {
      let total = 0;
      for (const [contract, decimals] of Object.entries(tokens)) {
        const res = await nativeFetch(BSC_RPC, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: '0x70a08231' + address.slice(2).padStart(64, '0') }, 'latest'] }),
        });
        const raw = BigInt((await res.json()).result || '0x0');
        const unit = 10n ** BigInt(Math.max(decimals - 2, 0));
        total += Number((raw + unit / 2n) / unit);
      }
      return total;
    } catch { return null; }
  }

  async function apply(ops, token) {
    const order = { delete: 0, update: 1, insert: 2 };
    for (const op of [...ops].sort((a, b) => order[a.kind] - order[b.kind])) {
      if (op.kind === 'delete') await supa(`/rest/v1/transactions?id=eq.${op.id}`, { method: 'DELETE', token });
      else if (op.kind === 'update') await supa(`/rest/v1/transactions?id=eq.${op.id}`, { method: 'PATCH', body: op.patch, token });
      else {
        const r = op.row;
        await supa('/rest/v1/rpc/save_transaction', {
          method: 'POST', token, body: {
            p: {
              id: null, date: r.date, account_id: r.account_id, transfer_account_id: r.transfer_account_id, amount_cents: r.amount_cents,
              transfer_amount_cents: r.transfer_amount_cents, payment: 'None', info: r.info, payee_id: null, category_id: r.category_id,
              memo: r.memo, tags: r.tags, splits: [],
            },
          },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The panel: a pill in the corner that opens into the sync preview.

  let host, root, state = { view: 'pill' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function build() {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
    root = host.attachShadow({ mode: 'closed' });
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    document.documentElement.appendChild(host);
  }

  const STYLE = `<style>
    :host{all:initial}
    *{box-sizing:border-box;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
    .glass{color:#141414;background:rgba(250,250,250,.94);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);
      box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 8px 30px rgba(0,0,0,.2)}
    .pill{display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px}
    .panel{width:min(440px,calc(100vw - 32px));max-height:min(620px,calc(100vh - 32px));display:flex;flex-direction:column;border-radius:16px;overflow:hidden}
    .head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px}
    .head b{font-size:16px;font-weight:650}
    .body{padding:0 16px 8px;overflow:auto}
    .foot{display:flex;gap:8px;justify-content:flex-end;padding:12px 16px;border-top:.5px solid rgba(0,0,0,.1)}
    button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;border-radius:999px}
    .main{padding:9px 14px;background:#2f6b4a;color:#fff;font-weight:600}
    .main[disabled]{opacity:.5;cursor:default}
    .sec{padding:9px 14px;background:rgba(0,0,0,.06);font-weight:500}
    .x{width:30px;height:30px;font-size:18px;color:#6b6b6b}
    .muted{color:#6b6b6b;font-size:13px}
    h3{margin:12px 0 2px;font-size:13px;font-weight:650;text-transform:uppercase;letter-spacing:.04em;color:#6b6b6b}
    .kv{display:grid;grid-template-columns:1fr auto;gap:2px 12px;margin:6px 0 10px}
    .kv span:nth-child(even){text-align:right;font-variant-numeric:tabular-nums}
    .warn{background:#fff4e5;color:#7a4b00;border-radius:10px;padding:8px 10px;margin:6px 0;font-size:13px}
    .err{color:#b3261e;margin:6px 0}
    ul{list-style:none;margin:6px 0;padding:0}
    li{display:grid;grid-template-columns:auto 1fr auto;gap:8px;padding:6px 0;border-top:.5px solid rgba(0,0,0,.08);font-size:13px}
    li i{font-style:normal;font-weight:600;width:16px;text-align:center}
    li small{display:block;color:#6b6b6b}
    li .amt{font-variant-numeric:tabular-nums;white-space:nowrap}
    .add i{color:#2f6b4a}.del i{color:#b3261e}.upd i{color:#8a5a00}
    input{width:100%;padding:9px 10px;margin:4px 0;border-radius:10px;border:.5px solid rgba(0,0,0,.2);background:#fff;color:inherit}
    a{color:#2f6b4a}
    @media (prefers-color-scheme:dark){
      .glass{color:#f2f2f0;background:rgba(36,36,40,.94)}
      .muted,li small,.x{color:#9a9a9a}.sec{background:rgba(255,255,255,.1)}
      .warn{background:#3a2a0e;color:#f3c97a}input{background:#1b1b1d;border-color:rgba(255,255,255,.2)}
      li,.foot{border-color:rgba(255,255,255,.1)}}
  </style>`;

  function counts() {
    const sw = collect([...docs.values(), ...alchemy.values()]);
    const bits = [];
    if (sw.transfers.size) bits.push(`${sw.transfers.size} wallet transfers`);
    if (sw.payments.size) bits.push(`${sw.payments.size}${sw.paymentsTotal ? '/' + sw.paymentsTotal : ''} payments`);
    if (sw.deposits.size) bits.push(`${sw.deposits.size} top-ups`);
    if (sw.balance) bits.push(money(sw.balance.cents));
    return bits.join(' · ');
  }

  function render() {
    if (!docs.size && !alchemy.size && state.view === 'pill') { if (host) host.style.display = 'none'; return; }
    if (!host) {
      if (!document.body) return void document.addEventListener('DOMContentLoaded', render, { once: true });
      build();
    }
    host.style.display = '';
    root.innerHTML = STYLE + views[state.view]();
    root.querySelector('[autofocus]')?.focus();
  }

  const views = {
    pill: () => `<div class="glass pill">
      <button class="main" data-do="open">Sync to Ledger${docs.size || alchemy.size ? ' · ' + esc(counts()) : ''}</button>
      <button class="x" data-do="forget" title="Forget what's loaded">×</button></div>`,

    signin: () => panel('Sign in to Ledger', `
      <p class="muted">Once only: the sync keeps this session in Tampermonkey's storage, which Superwallet's page can't read.</p>
      <form><input name="email" type="email" placeholder="Email" autocomplete="username" required autofocus>
      <input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
      ${state.error ? `<div class="err">${esc(state.error)}</div>` : ''}
      <div class="foot" style="padding:12px 0 4px;border:0"><button type="button" class="sec" data-do="close">Cancel</button><button class="main">Sign in</button></div></form>`, ''),

    busy: () => panel('Ledger sync', `<p class="muted">${esc(state.message || 'Working…')}</p>`, ''),

    preview: () => {
      const { result, walletResult, ledger } = state;
      const ops = [...result.ops, ...(walletResult ? walletResult.ops : [])];
      const b = result.balance;
      const card = section(ledger.account.name, ledger.card, result, b ? [
        ['Superwallet balance', b.superwallet], ['Ledger, from transactions', b.records],
        [b.gap < 0 ? 'Bank hold (pending payments)' : 'Difference', b.gap]] : []);
      const wb = walletResult && walletResult.balance;
      const wallet = walletResult ? section(ledger.walletAccount ? ledger.walletAccount.name : 'Wallet', ledger.wallet, walletResult, wb ? [
        ['On BNB Chain', wb.chain], ['Ledger after sync', wb.ledger]] : []) : '';
      return panel('Ledger sync', `${card}${wallet}
        ${state.error ? `<div class="err">${esc(state.error)}</div>` : ''}`,
        `<button class="sec" data-do="signout" title="Forget the Ledger session">Sign out</button><span style="flex:1"></span>
         <button class="sec" data-do="close">${ops.length ? 'Cancel' : 'Close'}</button>
         ${ops.length ? `<button class="main" data-do="apply">Apply ${ops.length} change${ops.length > 1 ? 's' : ''}</button>` : ''}`);
    },

    done: () => panel('Ledger sync', `<p>✓ ${esc(state.message)}</p>`, `<button class="main" data-do="close">Done</button>`),
  };
  /** One account's part of the preview: its balances, warnings and changes. */
  function section(name, account, result, balances) {
    // Changes to money first; rows that only gain or lose the "pending" tag are summed up in one line.
    const tagOnly = op => op.kind === 'update' && Object.keys(op.patch).every(k => k === 'tags');
    const pend = result.ops.filter(o => tagOnly(o) && o.patch.tags.includes('pending')).length;
    const settled = result.ops.filter(o => tagOnly(o) && !o.patch.tags.includes('pending')).length;
    const tagLine = [pend && `${pend} row${pend > 1 ? 's' : ''} marked pending`, settled && `${settled} row${settled > 1 ? 's' : ''} settled`].filter(Boolean).join(', ');
    const list = result.ops.filter(op => !tagOnly(op)).map(op => {
      const r = op.kind === 'insert' ? op.row : { ...op.before, ...op.patch };
      const cls = op.kind === 'insert' ? 'add' : op.kind === 'delete' ? 'del' : 'upd';
      const sign = op.kind === 'insert' ? '+' : op.kind === 'delete' ? '−' : '~';
      return `<li class="${cls}"><i>${sign}</i><span>${esc(r.memo || r.info || '')}<small>${esc(r.date)} · ${esc(op.why)}</small></span><span class="amt">${money(effect(r, account))}</span></li>`;
    }).join('');
    const tag = tagLine ? `<li class="upd"><i>~</i><span>${esc(tagLine)}<small>tag only, amounts unchanged</small></span><span></span></li>` : '';
    return `<h3>${esc(name)}</h3>
      ${balances.length ? `<div class="kv">${balances.map(([k, v]) => `<span>${esc(k)}</span><span>${money(v)}</span>`).join('')}</div>` : ''}
      ${result.warnings.map(w => `<div class="warn">${esc(w)}</div>`).join('')}
      ${list || tag ? `<ul>${list}${tag}</ul>` : '<p class="muted">In sync. Nothing to change.</p>'}
      ${result.notes.map(n => `<p class="muted">${esc(n)}</p>`).join('')}`;
  }

  function panel(title, body, foot) {
    return `<div class="glass panel"><div class="head"><b>${esc(title)}</b><button class="x" data-do="close">×</button></div>
      <div class="body">${body}</div>${foot ? `<div class="foot">${foot}</div>` : ''}</div>`;
  }

  const go = (view, extra = {}) => { state = { ...state, ...extra, view }; render(); };

  async function openSync() {
    go('busy', { message: 'Reading your Ledger…', error: '' });
    try {
      const s = await session();
      if (!s) return go('signin', { error: '' });
      const ledger = await loadLedger(s.access_token);
      const sw = collect([...docs.values(), ...alchemy.values()]);
      const result = plan(sw, ledger);
      let walletResult = null;
      if (ledger.wallet) {
        const address = sw.wallet || ledger.walletAddress;
        if (sw.wallet) GM_setValue('walletAddress', sw.wallet);
        state.message = 'Reading the wallet on BNB Chain…'; render();
        const after = applyTo(ledger.rows, result.ops).map((r, i) => (r.id == null ? { ...r, id: `planned${i}` } : r));
        walletResult = planWallet(sw, { ...ledger, rows: after }, await chainBalance(address, sw));
      }
      go('preview', { ledger, result, walletResult, error: '' });
    } catch (e) { go('signin', { error: e.message }); }
  }

  async function onClick(e) {
    const what = e.target.closest('[data-do]')?.dataset.do;
    if (!what) return;
    if (what === 'open') return openSync();
    if (what === 'close') return go('pill', { error: '' });
    if (what === 'forget') { docs.clear(); alchemy.clear(); return go('pill'); }
    if (what === 'signout') { GM_deleteValue('ledgerSession'); return go('pill'); }
    if (what === 'copy') {
      await navigator.clipboard.writeText([...alchemy.keys()].join('\n'));
      e.target.textContent = '✓ Copied'; setTimeout(render, 1500); return;
    }
    if (what === 'apply') {
      const { walletResult } = state;
      const result = { ...state.result, ops: [...state.result.ops, ...(walletResult ? walletResult.ops : [])] };
      go('busy', { message: `Applying ${result.ops.length} changes…` });
      try {
        const s = await session();
        if (!s) return go('signin', { error: 'Your Ledger session ended. Sign in again.' });
        await apply(result.ops, s.access_token);
        const n = k => result.ops.filter(o => o.kind === k).length;
        const b = result.balance;
        const wb = walletResult && walletResult.balance;
        go('done', { message: `Synced: ${n('insert')} added, ${n('update')} updated, ${n('delete')} removed.${b ? ` Card balance ${money(b.superwallet)}${b.gap ? `, of which ${money(b.gap)} is the bank hold` : ''}.` : ''}${wb ? ` Wallet ${money(wb.ledger)}${wb.gap ? ` (${money(wb.chain)} on-chain)` : ', same as on-chain'}.` : ''}` });
      } catch (err) {
        // Applying stops at the first failure; syncing again picks up from where it got to.
        go('preview', { error: `${err.message}. Some changes may have been made; press Sync again to finish.` });
      }
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    go('busy', { message: 'Signing in…' });
    try { await signIn(String(f.get('email')), String(f.get('password'))); await openSync(); }
    catch (err) { go('signin', { error: err.message }); }
  }
})();

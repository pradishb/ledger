// ==UserScript==
// @name         Superwallet → Ledger copy button
// @namespace    https://ledger.pradish.com.np/
// @version      1.1.0
// @description  When Superwallet loads your wallet transfers or card payments, shows a button that copies them for Ledger's Import page.
// @match        https://superwallet.xhype.io/*
// @run-at       document-start
// @grant        none
// @downloadURL  https://ledger.pradish.com.np/superwallet.user.js
// @updateURL    https://ledger.pradish.com.np/superwallet.user.js
// ==/UserScript==

// What it does: it watches the two responses Ledger's Import page asks for and keeps a copy
// of each in this tab, then shows a "Copy for Ledger" button. Nothing is sent anywhere: the
// copy only goes to your clipboard when you press the button.
//   Wallet transfers: Alchemy's alchemy_getAssetTransfers calls (bnb-mainnet.g.alchemy.com/v2/)
//   Card payments:    api.superwallet.xhype.io/v2/transactions/ (every page you load)
// Superwallet shows wallet transfers on /dashboard and card payments on /cards.
(() => {
  'use strict';
  if (window.top !== window.self) return; // not inside frames

  const isTransfers = (url, body) =>
    /^https:\/\/bnb-mainnet\.g\.alchemy\.com\/v2\//.test(url) && /alchemy_getAssetTransfers/.test(body || '');
  const isCards = url => /^https:\/\/api\.superwallet\.xhype\.io\/v2\/transactions\//.test(url);

  const captured = new Map(); // response text -> 'transfers' | 'cards', so repeats count once

  function keep(kind, text) {
    if (!text || captured.has(text)) return;
    try { JSON.parse(text); } catch { return; }
    captured.set(text, kind);
    render();
  }

  // A request body as text, whatever form the page sent it in (libraries often send bytes).
  async function bodyText(body) {
    try {
      if (body == null) return '';
      if (typeof body === 'string') return body;
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
      if (body instanceof Blob) return await body.text();
      if (body instanceof URLSearchParams) return body.toString();
    } catch { /* unreadable: treat as empty */ }
    return '';
  }

  async function watch(url, body, readText) {
    if (!isCards(url) && !/alchemy\.com/.test(url)) return; // cheap check before reading anything
    const kind = isCards(url) ? 'cards' : isTransfers(url, await bodyText(await body)) ? 'transfers' : null;
    if (kind) readText().then(text => keep(kind, text), () => {});
  }

  // fetch
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url ?? '';
    const body = init && 'body' in init ? init.body
      : input instanceof Request ? input.clone().text().catch(() => '') : '';
    const result = realFetch.apply(this, arguments);
    result.then(res => watch(url, body, () => res.clone().text()), () => {});
    return result;
  };

  // XMLHttpRequest
  const realOpen = XMLHttpRequest.prototype.open;
  const realSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__swUrl = String(url);
    return realOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const url = new URL(this.__swUrl || '', location.href).href;
    this.addEventListener('load', () => {
      watch(url, body, async () =>
        this.responseType === '' || this.responseType === 'text' ? this.responseText
        : this.responseType === 'json' ? JSON.stringify(this.response) : '');
    });
    return realSend.apply(this, arguments);
  };

  // The button: a small pill in the bottom-right corner, in a shadow root so the page's
  // styles can't change it.
  let host, label, clear;
  function build() {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .pill{display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;
          font:500 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#141414;
          background:rgba(250,250,250,.92);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);
          box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 6px 24px rgba(0,0,0,.18)}
        button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;border-radius:999px}
        .copy{padding:10px 14px;background:#2f6b4a;color:#fff;font-weight:600}
        .copy:active{transform:scale(.97)}
        .x{width:32px;height:32px;font-size:18px;color:#6b6b6b}
        .x:hover{background:rgba(0,0,0,.06)}
        @media (prefers-color-scheme:dark){.pill{color:#f2f2f0;background:rgba(40,40,44,.92)}.x{color:#9a9a9a}}
      </style>
      <div class="pill"><button class="copy"></button><button class="x" title="Forget these and hide">×</button></div>`;
    label = root.querySelector('.copy');
    clear = root.querySelector('.x');
    label.addEventListener('click', copy);
    clear.addEventListener('click', () => { captured.clear(); render(); });
    document.documentElement.appendChild(host);
  }

  function summary() {
    const n = { transfers: 0, cards: 0 };
    for (const kind of captured.values()) n[kind]++;
    const parts = [];
    if (n.transfers) parts.push(`${n.transfers} transfer list${n.transfers > 1 ? 's' : ''}`);
    if (n.cards) parts.push(`${n.cards} card page${n.cards > 1 ? 's' : ''}`);
    return parts.join(' + ');
  }

  function render(message) {
    if (!captured.size) { if (host) host.style.display = 'none'; return; }
    if (!host) {
      if (!document.body) return void document.addEventListener('DOMContentLoaded', () => render(), { once: true });
      build();
    }
    host.style.display = '';
    label.textContent = message || `Copy for Ledger · ${summary()}`;
  }

  async function copy() {
    const text = [...captured.keys()].join('\n'); // Ledger's Import page reads several JSON documents in a row
    try {
      await navigator.clipboard.writeText(text);
      render(`✓ Copied ${summary()}`);
    } catch {
      // Older browsers or a denied permission: fall back to a hidden textarea.
      const t = document.createElement('textarea');
      t.value = text; t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove();
      render(ok ? `✓ Copied ${summary()}` : "Couldn't copy");
    }
    setTimeout(() => render(), 2000);
  }
})();

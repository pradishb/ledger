# Ledger

Personal finance tracker: React + TypeScript + Vite, Supabase (Postgres + Auth), installable as a PWA.
UI: [shadcn/ui](https://ui.shadcn.com) (Radix + Tailwind v4) components in `src/components/ui/`, and
[TanStack Table](https://tanstack.com/table) for the Accounts and Transactions tables (`src/components/data-table.tsx`).
Ported from the Claude Design file `Finance Tracker.dc.html`.

## Setup

1. **Create a Supabase project** at https://supabase.com.
2. **Run the schema:** open SQL Editor and run each file in `supabase/migrations/` in order
   (`0001_init.sql`, then `0002_currencies.sql`), or `supabase db push` if you use the Supabase CLI.
3. **Make it single-user:**
   - Authentication → Users → *Add user*. Pick an email and password and tick *Auto confirm*.
   - Authentication → Sign In / Providers → turn **off** *Allow new users to sign up*.
4. **Configure the app:**
   ```sh
   cp .env.example .env   # fill in URL + publishable/anon key from Project Settings → API
   npm install
   npm run dev
   ```
5. Sign in, click **Add starter categories**, then add your accounts on the Accounts page.

## Previewing without signing in

With `npm run dev` running, open `/preview.html?page=/accounts` (add `&theme=dark` for dark mode). It renders
the real app on made-up sample data, without Supabase, so layouts can be checked quickly. It isn't part of the
production build.

## Deploy (needed for the phone)

A PWA needs HTTPS. This app is deployed as a Cloudflare Worker that serves static files, at
https://ledger.pradish.com.np (set in `wrangler.jsonc`):

```sh
npx wrangler login   # once
npm run deploy       # builds with your local .env, then uploads dist/
```

The `VITE_*` values are built into the bundle, so deploy from a machine that has `.env`. Paths like
`/accounts` fall back to `index.html` through `not_found_handling`.

Install on the phone:
- **iPhone:** open the site in Safari → Share → *Add to Home Screen*.
- **Android:** open the site in Chrome → menu → *Install app*.

## How it works

- **Data:** the whole data set is loaded into one TanStack Query cache and recalculated in the browser
  (balances, stats, trends), the same way as the design. Writes go to Supabase, and then the cache refetches.
- **Offline:** the cache is saved to IndexedDB, so the app opens and shows your last data with no
  connection. Editing is turned off while offline. The service worker caches the app shell.
- **Money** is stored as integer cents. **Transfers** are a single row with `transfer_account_id`.
  **Split** transactions store their lines in `transaction_splits` and are saved atomically by the
  `save_transaction` Postgres function.
- **Payees from the memo:** each payee has memo patterns (Categories & payees → Payees → *Matches memo*).
  A transaction saved without a payee, that isn't a transfer, gets the payee whose pattern its memo contains,
  matching whole words and ignoring case and punctuation; the longest pattern wins. A Postgres trigger does this
  on insert and when the memo is edited (`0006_payee_match.sql`), so it also covers rows written by other tools
  such as txn-sync. Existing transactions are only matched when you press *Assign payees* on the Payees tab
  (`apply_payee_match()`, `0008`); editing patterns alone changes no transactions. A payee set by hand is never
  replaced, and only the payee is set, never the category or payment.
- **Security:** every table has row level security tied to `auth.uid()`.
- **Currencies:** every account has a currency, and its amounts and balance are stored and shown in it.
  Net worth, group totals and reports are converted to the *display currency* (picked on Overview and
  Accounts, USD by default, remembered per device) at today's rates. The rates come from the free
  [fawazahmed0 currency API](https://github.com/fawazahmed0/exchange-api) and are cached for offline use.
  A transfer between currencies stores the amount received in `transfer_amount_cents`.

Optional `.env` setting: `VITE_LOCALE`.

## Superwallet sync

`public/superwallet.user.js` is a Tampermonkey script that keeps the Superwallet card and wallet accounts in step
with Superwallet. Install it from
https://raw.githubusercontent.com/pradishb/ledger/main/public/superwallet.user.js (Tampermonkey updates it from
there). On superwallet.xhype.io, open the Dashboard (wallet transfers) and the Cards page, page through the
payments, and press **Sync to Ledger**:
it signs in to Ledger once, shows every change, and applies them when you press Apply.

- Rows are matched by Superwallet's ids in Info, so syncing twice changes nothing. Categories, payees and memos
  you set are kept; new payments take the category last used for the same merchant.
- Pending payments carry the tag `pending` until they settle. A cancelled hold (VOID) keeps only its fees, and a
  failed payment has no rows. Missing top-ups are added.
- Superwallet's bank holds extra money while payments are pending, and that never appears in its transactions.
  The sync keeps one row with Info `superwallet:hold` for the difference between Superwallet's balance and
  everything else, so the account always shows Superwallet's balance. It goes once the hold is released.
- The wallet: USDT/USDC transfers are matched by transaction hash. A card top-up is a transfer to the card account
  plus a row for Superwallet's fee (2.1%); other transfers are income or spending, with the category last used for
  that address. Its balance is checked against what the wallet holds on BNB Chain (read from a public node); a
  difference is reported, since it means some history isn't loaded.

## Importing from HomeBank

```sh
node scripts/import-homebank.mjs file.xhb import.sql            # into an empty ledger
node scripts/import-homebank.mjs --replace file.xhb import.sql  # delete the current ledger first
```

Run `import.sql` in the Supabase SQL Editor. It is one transaction, so if anything fails, nothing
changes. Each account keeps its HomeBank currency, but HomeBank's exchange rates aren't imported. The script
prints how many accounts are in each currency, and any account whose balance doesn't match HomeBank.

## Not built yet

- Deleting accounts. Hide them instead; editing works from the Accounts page.
- Renaming categories and payees.
- CSV import and bank sync.
- Adding transactions while offline.

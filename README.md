# Ledger

Personal finance tracker: React + TypeScript + Vite, Supabase (Postgres + Auth), installable as a PWA.
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
- **Security:** every table has row level security tied to `auth.uid()`.
- **Currencies:** every account has a currency, and its amounts and balance are stored and shown in it.
  Net worth, group totals and reports are converted to the *display currency* (picked on Overview and
  Accounts, USD by default, remembered per device) at today's rates. The rates come from the free
  [fawazahmed0 currency API](https://github.com/fawazahmed0/exchange-api) and are cached for offline use.
  A transfer between currencies stores the amount received in `transfer_amount_cents`.

Optional `.env` setting: `VITE_LOCALE`.

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

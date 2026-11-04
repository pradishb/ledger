# Ledger

Personal finance tracker: React + TypeScript + Vite, Supabase (Postgres + Auth), installable as a PWA.
Ported from the Claude Design file `Finance Tracker.dc.html`.

## Setup

1. **Create a Supabase project** at https://supabase.com.
2. **Run the schema:** open SQL Editor and paste and run `supabase/migrations/0001_init.sql`
   (or `supabase db push` if you use the Supabase CLI).
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

A PWA needs HTTPS. Any static host works, for example Vercel, Netlify or Cloudflare Pages:

- Build command `npm run build`, output directory `dist`
- Set the same `VITE_*` environment variables in the host
- Make every path fall back to `/index.html` (SPA routing). Vercel and Netlify need a rewrite rule. On
  Cloudflare Pages this works by default.

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

Optional `.env` settings: `VITE_CURRENCY` (ISO code, default `USD`) and `VITE_LOCALE`.

## Not built yet

- Editing or deleting accounts (only adding). For now use the Supabase table editor.
- Renaming categories and payees.
- CSV import and bank sync.
- Adding transactions while offline.

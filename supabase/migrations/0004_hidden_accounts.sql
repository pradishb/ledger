-- Accounts can be hidden: left out of the Overview and of the account pickers for new
-- transactions, but still counted in balances and net worth, and still listed on the Accounts page.

alter table public.accounts add column hidden boolean not null default false;

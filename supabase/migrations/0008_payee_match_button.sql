-- Existing transactions get payees from the memo only when asked (the "Assign payees" button on the
-- Payees tab), never as a side effect of editing a payee's patterns.
--
-- Still automatic: a transaction saved without a payee when it is inserted or its memo is edited
-- (the transactions_match_payee trigger from 0006).

drop trigger payees_apply_match on public.payees;
drop function public.payees_apply_match();

-- In case it was switched off while the payees were set up.
alter table public.transactions enable trigger transactions_match_payee;

-- Give every transaction without a payee (and not a transfer) the payee its memo matches, the same
-- way the trigger does: whole words, longest pattern wins. Returns how many were assigned.
-- Runs as the caller, so RLS limits it to their own rows.
create or replace function public.apply_payee_match()
returns integer
language sql
security invoker
set search_path = public
as $$
  with pats as (
    select p.id as payee_id, payee_match_text(m) as pm
    from payees p, unnest(p.match) m
    where p.user_id = auth.uid() and payee_match_text(m) <> '  '
  ), memos as (
    select id, payee_match_text(memo) as mt from transactions
    where user_id = auth.uid() and payee_id is null and transfer_account_id is null and memo <> ''
  ), best as (
    select distinct on (memos.id) memos.id, pats.payee_id
    from memos join pats on strpos(memos.mt, pats.pm) > 0
    order by memos.id, length(pats.pm) desc, pats.payee_id
  ), done as (
    update transactions t set payee_id = best.payee_id from best where t.id = best.id
    returning 1
  )
  select count(*)::integer from done
$$;

revoke execute on function public.apply_payee_match() from public, anon;
grant execute on function public.apply_payee_match() to authenticated;

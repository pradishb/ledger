-- Payees are assigned automatically from the memo.
--
-- Each payee has a list of memo patterns. A transaction saved without a payee (and not a transfer)
-- gets the payee whose pattern appears in its memo. A pattern matches whole words, ignoring case and
-- punctuation, so "S.S. Stores" matches "Groceries,S. S. STORES PVT. LTD." but "Stores" does not match
-- "Storeskeeper". When several patterns match, the longest wins.
--
-- Rows are filled in when they are inserted, when their memo changes, and when a payee's patterns
-- change (then every transaction that still has no payee is checked). A payee set by hand is never
-- replaced, and clearing a payee by hand sticks until the memo is edited.

alter table public.payees add column match text[] not null default '{}';

-- " word word " : lower case, runs of anything but a-z0-9 become one space, padded with spaces
-- so a pattern can be found as whole words with strpos.
create or replace function public.payee_match_text(t text)
returns text
language sql
immutable
as $$
  select ' ' || trim(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', ' ', 'g')) || ' '
$$;

-- The payee whose longest pattern appears in the memo, or null.
create or replace function public.match_payee(p_user uuid, p_memo text)
returns bigint
language sql
stable
set search_path = public
as $$
  select p.id
  from payees p, unnest(p.match) m
  where p.user_id = p_user
    and payee_match_text(m) <> '  '
    and strpos(payee_match_text(p_memo), payee_match_text(m)) > 0
  order by length(payee_match_text(m)) desc, p.id
  limit 1
$$;

create or replace function public.transactions_match_payee()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payee_id is null and new.transfer_account_id is null and new.memo <> ''
     and (tg_op = 'INSERT' or new.memo is distinct from old.memo) then
    new.payee_id := match_payee(new.user_id, new.memo);
  end if;
  return new;
end;
$$;

create trigger transactions_match_payee
  before insert or update of memo on public.transactions
  for each row execute function public.transactions_match_payee();

-- When a payee's patterns change, give it the transactions without a payee that it now wins.
create or replace function public.payees_apply_match()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if cardinality(new.match) > 0 and (tg_op = 'INSERT' or new.match is distinct from old.match) then
    -- each memo and pattern is normalised once; only memos containing a pattern are checked for a longer one
    with pats as (
      select distinct payee_match_text(m) as pm from unnest(new.match) m where payee_match_text(m) <> '  '
    ), candidates as (
      select c.id, c.memo from (
        select id, memo, payee_match_text(memo) as mt from transactions
        where user_id = new.user_id and payee_id is null and transfer_account_id is null and memo <> ''
      ) c
      where exists (select 1 from pats where strpos(c.mt, pats.pm) > 0)
    )
    update transactions t set payee_id = new.id
    from candidates c
    where t.id = c.id and match_payee(new.user_id, c.memo) = new.id;
  end if;
  return null;
end;
$$;

create trigger payees_apply_match
  after insert or update of match on public.payees
  for each row execute function public.payees_apply_match();

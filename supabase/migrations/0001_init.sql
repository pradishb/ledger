-- Ledger schema. All money is stored as integer cents.
-- Every table is scoped to the signed-in user via row level security.

create table public.accounts (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  type          text not null check (type in ('bank', 'cash', 'credit', 'asset', 'liability')),
  institution   text not null default '',
  opening_cents bigint not null default 0,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);

create table public.categories (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  parent_id  bigint references public.categories on delete restrict,
  type       text not null check (type in ('exp', 'inc')),
  color      text,
  created_at timestamptz not null default now()
);

create table public.payees (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  name                text not null check (length(trim(name)) > 0),
  default_category_id bigint references public.categories on delete set null,
  default_payment     text not null default 'None',
  created_at          timestamptz not null default now()
);
create unique index payees_user_name on public.payees (user_id, lower(name));

-- A transfer is one row: money leaves account_id and enters transfer_account_id
-- (amount_cents is from account_id's point of view, so transfers are negative).
-- A split transaction has category_id null and rows in transaction_splits.
create table public.transactions (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null default auth.uid() references auth.users on delete cascade,
  date                date not null,
  account_id          bigint not null references public.accounts on delete restrict,
  transfer_account_id bigint references public.accounts on delete restrict,
  amount_cents        bigint not null,
  payment             text not null default 'None',
  info                text not null default '',
  payee_id            bigint references public.payees on delete restrict,
  category_id         bigint references public.categories on delete restrict,
  memo                text not null default '',
  tags                text[] not null default '{}',
  status              text not null default 'none' check (status in ('none', 'clr', 'rec')),
  created_at          timestamptz not null default now(),
  check (transfer_account_id is null or transfer_account_id <> account_id),
  check (transfer_account_id is null or category_id is null)
);
create index transactions_user_date on public.transactions (user_id, date);

create table public.transaction_splits (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  transaction_id bigint not null references public.transactions on delete cascade,
  position       int not null default 0,
  category_id    bigint not null references public.categories on delete restrict,
  memo           text not null default '',
  amount_cents   bigint not null
);
create index transaction_splits_txn on public.transaction_splits (transaction_id);

-- Row level security: each user sees and edits only their own rows.
do $$
declare t text;
begin
  foreach t in array array['accounts', 'categories', 'payees', 'transactions', 'transaction_splits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Insert or update a transaction together with its split lines, atomically.
-- Runs as the caller, so RLS still applies.
create or replace function public.save_transaction(p jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint := nullif(p->>'id', '')::bigint;
  v_tags text[] := coalesce(array(select jsonb_array_elements_text(p->'tags')), '{}');
begin
  if v_id is null then
    insert into transactions (date, account_id, transfer_account_id, amount_cents, payment, info,
                              payee_id, category_id, memo, tags, status)
    values ((p->>'date')::date, (p->>'account_id')::bigint, (p->>'transfer_account_id')::bigint,
            (p->>'amount_cents')::bigint, coalesce(p->>'payment', 'None'), coalesce(p->>'info', ''),
            (p->>'payee_id')::bigint, (p->>'category_id')::bigint, coalesce(p->>'memo', ''),
            v_tags, coalesce(p->>'status', 'none'))
    returning id into v_id;
  else
    update transactions set
      date = (p->>'date')::date,
      account_id = (p->>'account_id')::bigint,
      transfer_account_id = (p->>'transfer_account_id')::bigint,
      amount_cents = (p->>'amount_cents')::bigint,
      payment = coalesce(p->>'payment', 'None'),
      info = coalesce(p->>'info', ''),
      payee_id = (p->>'payee_id')::bigint,
      category_id = (p->>'category_id')::bigint,
      memo = coalesce(p->>'memo', ''),
      tags = v_tags,
      status = coalesce(p->>'status', 'none')
    where id = v_id;
    if not found then
      raise exception 'Transaction % not found', v_id;
    end if;
    delete from transaction_splits where transaction_id = v_id;
  end if;

  insert into transaction_splits (transaction_id, position, category_id, memo, amount_cents)
  select v_id, s.ord::int, (s.val->>'category_id')::bigint, coalesce(s.val->>'memo', ''),
         (s.val->>'amount_cents')::bigint
  from jsonb_array_elements(coalesce(p->'splits', '[]'::jsonb)) with ordinality as s(val, ord);

  return v_id;
end;
$$;

revoke execute on function public.save_transaction(jsonb) from public, anon;
grant execute on function public.save_transaction(jsonb) to authenticated;

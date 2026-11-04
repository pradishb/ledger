-- Multiple currencies.
--
-- Every account has a currency (ISO 4217 code), and its amounts are stored in that
-- currency. Exchange rates are not stored: the app fetches today's rates and converts
-- totals into the display currency the viewer picks.
--
-- Existing accounts are set to USD; change them on the Accounts page if they are not.

alter table public.accounts add column currency text not null default 'USD'
  check (currency ~ '^[A-Z]{3}$');
alter table public.accounts alter column currency drop default;

-- What arrives in transfer_account_id, in that account's currency (positive for a normal
-- transfer). Null means the same amount as left, which is right when both accounts share a currency.
alter table public.transactions add column transfer_amount_cents bigint;
alter table public.transactions add constraint transactions_transfer_amount
  check (transfer_amount_cents is null or transfer_account_id is not null);

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
    insert into transactions (date, account_id, transfer_account_id, amount_cents, transfer_amount_cents,
                              payment, info, payee_id, category_id, memo, tags, status)
    values ((p->>'date')::date, (p->>'account_id')::bigint, (p->>'transfer_account_id')::bigint,
            (p->>'amount_cents')::bigint, (p->>'transfer_amount_cents')::bigint,
            coalesce(p->>'payment', 'None'), coalesce(p->>'info', ''),
            (p->>'payee_id')::bigint, (p->>'category_id')::bigint, coalesce(p->>'memo', ''),
            v_tags, coalesce(p->>'status', 'none'))
    returning id into v_id;
  else
    update transactions set
      date = (p->>'date')::date,
      account_id = (p->>'account_id')::bigint,
      transfer_account_id = (p->>'transfer_account_id')::bigint,
      amount_cents = (p->>'amount_cents')::bigint,
      transfer_amount_cents = (p->>'transfer_amount_cents')::bigint,
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

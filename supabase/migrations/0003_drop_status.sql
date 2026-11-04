-- Remove the transaction status (none / cleared / reconciled). The app no longer uses it.

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
                              payment, info, payee_id, category_id, memo, tags)
    values ((p->>'date')::date, (p->>'account_id')::bigint, (p->>'transfer_account_id')::bigint,
            (p->>'amount_cents')::bigint, (p->>'transfer_amount_cents')::bigint,
            coalesce(p->>'payment', 'None'), coalesce(p->>'info', ''),
            (p->>'payee_id')::bigint, (p->>'category_id')::bigint, coalesce(p->>'memo', ''),
            v_tags)
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
      tags = v_tags
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

alter table public.transactions drop column status;

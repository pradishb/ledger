-- Payees no longer carry a default category or payment. Only the payee is assigned (from the memo,
-- see 0006), and picking a payee in the app never fills in a category or payment.

alter table public.payees drop column default_category_id, drop column default_payment;

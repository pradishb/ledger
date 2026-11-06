-- A short note on how an account grows, written by hand and shown as a badge: "5% p.a." on a
-- savings account, the current rate per tola on gold.

alter table public.accounts add column growth text not null default '';

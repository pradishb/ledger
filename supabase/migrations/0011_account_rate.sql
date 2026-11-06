-- Accounts get an annual rate (percent): what a bank pays, or how fast gold or property gains value.
-- Expected income is the balance times this rate. Null means no rate.
-- Rates were kept as tags like "+2.75%"; each moves into the new column and leaves the tags.

alter table public.accounts add column rate numeric;

update public.accounts a
set rate = m.r,
    tags = array(select x from unnest(a.tags) x where x !~ '^\+?-?[0-9]+(\.[0-9]+)?%$')
from (
  select id,
         (select (regexp_match(x, '^\+?(-?[0-9]+(?:\.[0-9]+)?)%$'))[1]::numeric
            from unnest(tags) x
           where x ~ '^\+?-?[0-9]+(\.[0-9]+)?%$'
           limit 1) as r
  from public.accounts
) m
where m.id = a.id and m.r is not null;

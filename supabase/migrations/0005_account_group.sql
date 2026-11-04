-- Accounts have a free-form group (what HomeBank calls a group) instead of an institution.

alter table public.accounts rename column institution to group_name;

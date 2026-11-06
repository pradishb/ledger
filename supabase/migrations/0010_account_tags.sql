-- Accounts get a list of tags in place of the single growth note, so they can be used for anything
-- ("5% p.a.", "joint", "emergency fund"). Each existing growth note becomes the first tag.

alter table public.accounts add column tags text[] not null default '{}';
update public.accounts set tags = array[growth] where growth <> '';
alter table public.accounts drop column growth;

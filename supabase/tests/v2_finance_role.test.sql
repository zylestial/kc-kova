-- The Finance account type and its request switches
-- (0075_finance_role.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006f1', 'fin1@test.local');

select lives_ok(
  $$ insert into accounts (id, username, name, role) values
       ('00000000-0000-0000-0000-0000000006f1', 'fin1', 'Fe Nance', 'Finance') $$,
  'A Finance account can exist');
select lives_ok(
  $$ insert into account_invites (email, role, token_hash, expires_at, invited_by)
     select 'fin2@test.local', 'Finance', 'hash-fin2', now() + interval '1 day', id from accounts limit 1 $$,
  'and can be invited');

create function pg_temp.daily() returns boolean language sql as $$
  select public.can_request_daily(a) from accounts a where username = 'fin1';
$$;
create function pg_temp.company() returns boolean language sql as $$
  select public.can_request_company(a) from accounts a where username = 'fin1';
$$;

select ok(not pg_temp.daily() and not pg_temp.company(), 'Finance cannot request by default');
update accounts set can_request_daily = true where username = 'fin1';
select ok(pg_temp.daily(), 'An Admin allows Finance Daily requests');
select throws_ok(
  $$ update accounts set can_request_company = true where username = 'fin1' $$,
  '23514', null, 'Company trips still need a Position');
update accounts set can_request_company = true, position = 'Accountant' where username = 'fin1';
select ok(pg_temp.company(), 'With a Position, Finance can request company trips');
select is((select driver_type from accounts where username = 'fin1'), null, 'Finance has no Driver type');

select throws_ok(
  $$ update accounts set role = 'Bookkeeper' where username = 'fin1' $$,
  '23514', null, 'Unknown account types are still refused');

select * from finish();
rollback;

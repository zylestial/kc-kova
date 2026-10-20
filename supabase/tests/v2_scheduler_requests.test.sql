-- Schedulers make requests only when an Admin allows it
-- (0074_scheduler_requests.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'schedoff@test.local'),
  ('00000000-0000-0000-0000-0000000005a2', 'schedon@test.local'),
  ('00000000-0000-0000-0000-0000000005a3', 'reqs@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000005a1', 'schedoff', 'Sid Off', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000005a2', 'schedon', 'Sue On', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000005a3', 'reqs', 'Rae S', 'Requester');

create function pg_temp.daily(p_user text) returns boolean language sql as $$
  select public.can_request_daily(a) from accounts a where username = p_user;
$$;
create function pg_temp.company(p_user text) returns boolean language sql as $$
  select public.can_request_company(a) from accounts a where username = p_user;
$$;

select ok(not pg_temp.daily('schedoff'), 'A Scheduler cannot make Daily requests by default');
select ok(not pg_temp.company('schedoff'), 'nor Company trip requests');

select lives_ok(
  $$ update accounts set can_request_daily = true where username = 'schedon' $$,
  'An Admin allows a Scheduler Daily requests');
select ok(pg_temp.daily('schedon'), 'and they can make them');
select throws_ok(
  $$ update accounts set can_request_company = true where username = 'schedon' $$,
  '23514', null, 'Company trips still need a Position');
select lives_ok(
  $$ update accounts set can_request_company = true, position = 'Planner' where username = 'schedon' $$,
  'With a Position, an Admin allows a Scheduler company trips');
select ok(pg_temp.company('schedon'), 'and they can request them');

update accounts set role = 'Requester' where username = 'schedon';
select is((select can_request_daily from accounts where username = 'schedon'), false,
  'Someone who stops being a Scheduler loses the Daily switch');

update accounts set can_request_daily = true where username = 'reqs';
select is((select can_request_daily from accounts where username = 'reqs'), false,
  'The Daily switch only stays on Drivers and Schedulers');

update accounts set status = 'Inactive', can_request_daily = true, role = 'Scheduler' where username = 'schedoff';
select ok(not pg_temp.daily('schedoff'), 'An inactive Scheduler cannot request');

select * from finish();
rollback;

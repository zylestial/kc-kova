-- Type to add (0098): anyone signed in adds a destination or purpose to the
-- list; the same name (ignoring case and spaces) is never added twice; a
-- name the Admin turned off is refused; other lists stay Admin-only.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000002b1', 'rhea98@test.local');
insert into accounts (id, username, name, role) values ('00000000-0000-0000-0000-0000000002b1', 'rhea98', 'Rhea Santos', 'Requester');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'ab-d1', 'Wilcon Bauang', 'Active'),
  ('destinations', 'ab-d2', 'Old Quarry', 'Inactive');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');

select is((public.add_booking_option('destinations', '  wilcon   BAUANG ')).id, 'ab-d1',
  'the same name, in other case and spacing, returns the existing one');
select is((public.add_booking_option('destinations', 'Rosario  Public Market')).name, 'Rosario Public Market',
  'a new destination is added, spaces tidied');
select is((select a.account_name from booking_option_additions a join booking_options o on o."group" = a.option_group and o.id = a.option_id where o.name = 'Rosario Public Market'), 'Rhea Santos',
  'it records who added it');
select is((select status from booking_options where name = 'Rosario Public Market'), 'Active', 'it is on the list for everyone');
select is((public.add_booking_option('purposes', 'Deliver permits')).name, 'Deliver permits', 'purposes can be added too');
select throws_ok($$ select public.add_booking_option('destinations', 'old quarry') $$, '22023', NULL,
  'a name the Admin turned off is refused');
select throws_ok($$ select public.add_booking_option('projects', 'New Site') $$, '42501', NULL,
  'Department / Project Site stays Admin-only');
select throws_ok($$ select public.add_booking_option('destinations', 'x') $$, '22023', NULL, 'a one-letter name is refused');

reset role;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$ select public.add_booking_option('destinations', 'Anon Place') $$, '42501', NULL,
  'no account, no adding');

select * from finish();
rollback;

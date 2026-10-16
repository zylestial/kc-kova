-- v2.4: Urgent covers today up to 6 days ahead; Regular starts at 7
-- (0040_urgent_within_week.sql). Every future date can be requested.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000007a', 'juan7@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000007a', 'juan7', 'Juan Seven', 'Requester');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd77', 'City Hall 77', 'Active'),
  ('purposes', 'p77', 'Inspection', 'Active');

create function pg_temp.ask(p_days int, p_type text) returns void language sql as $$
  select null::void from create_request(
    (now() at time zone 'Asia/Manila')::date + p_days, p_type, null, null,
    '[{"destinationId":"d77","purposeId":"p77"}]', null);
$$;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000007a', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok($$ select pg_temp.ask(0, 'URGENT') $$, 'Urgent today is accepted');
select lives_ok($$ select pg_temp.ask(2, 'URGENT') $$, 'Urgent 2 days ahead is accepted (was refused before)');
select lives_ok($$ select pg_temp.ask(6, 'URGENT') $$, 'Urgent 6 days ahead is accepted');
select throws_ok($$ select pg_temp.ask(7, 'URGENT') $$, '22023', 'Urgent requests are for today up to 6 days ahead',
  'Urgent 7 days ahead is refused: that is Regular');
select throws_ok($$ select pg_temp.ask(-1, 'URGENT') $$, '22023', 'Urgent requests are for today up to 6 days ahead',
  'Urgent in the past is refused for a Requester');
select throws_ok($$ select pg_temp.ask(6, 'REGULAR') $$, '22023', 'Regular requests need at least 7 days'' notice',
  'Regular 6 days ahead is still refused');
select lives_ok($$ select pg_temp.ask(7, 'REGULAR') $$, 'Regular 7 days ahead is accepted');

select * from finish();
rollback;

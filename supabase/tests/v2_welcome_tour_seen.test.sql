-- The welcome tour (0084): an account starts with the tour not seen, and
-- mark_tour_seen marks only the signed-in account's own tour, once.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008b1', 'rhea8@test.local'),
  ('00000000-0000-0000-0000-0000000008b2', 'dan8@test.local'),
  ('00000000-0000-0000-0000-0000000008b3', 'old8@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000008b1', 'rhea8', 'Rhea Santos', 'Requester'),
  ('00000000-0000-0000-0000-0000000008b2', 'dan8', 'Dan Driver', 'Driver');
insert into accounts (id, username, name, role, status) values
  ('00000000-0000-0000-0000-0000000008b3', 'old8', 'Old Account', 'Requester', 'Inactive');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create temp table seen (k text primary key, v timestamptz);
grant select, insert on seen to authenticated;

-- Tests --------------------------------------------------------------------
select is((select tour_seen_at from accounts where username = 'rhea8'), null, 'a new account has not seen the tour');

select pg_temp.act_as('00000000-0000-0000-0000-0000000008b1');
insert into seen select 'first', mark_tour_seen();
select isnt((select v from seen where k = 'first'), null, 'mark_tour_seen returns when it was marked');
select is((select tour_seen_at from accounts where username = 'dan8'), null, 'another account''s tour is left alone');

insert into seen select 'again', mark_tour_seen();
select is((select v from seen where k = 'again'), (select v from seen where k = 'first'), 'marking it again keeps the first time');

select pg_temp.act_as('00000000-0000-0000-0000-0000000008b3');
select throws_ok('select mark_tour_seen()', '42501', 'Not authorized', 'an Inactive account is refused');

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok('select mark_tour_seen()', '42501', null, 'signed-out callers cannot run it');

reset role;
select is((select tour_seen_at from accounts where username = 'rhea8'), (select v from seen where k = 'first'), 'the mark is saved on the account');

select * from finish();
rollback;

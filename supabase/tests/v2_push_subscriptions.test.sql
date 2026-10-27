-- Phone notifications (0069): each account saves and removes only its own
-- devices, and a device moves to whoever turned push on there last.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'push1@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'push2@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'push3@test.local');
insert into accounts (id, username, name, role, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'push1', 'Pia Push', 'Requester', 'Active'),
  ('00000000-0000-0000-0000-0000000000a2', 'push2', 'Pat Push', 'Driver', 'Active'),
  ('00000000-0000-0000-0000-0000000000a3', 'push3', 'Paz Push', 'Requester', 'Inactive');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok(
  $$ select save_push_subscription('https://push.test/device-1', 'key', 'secret', 'Chrome') $$,
  'an account saves its device'
);
select lives_ok(
  $$ select save_push_subscription('https://push.test/device-1', 'key2', 'secret2', 'Chrome') $$,
  'saving the same device again is fine'
);
select is(
  (select count(*)::int from push_subscriptions where endpoint = 'https://push.test/device-1'),
  1,
  'and keeps one row for it'
);
select throws_ok(
  $$ select save_push_subscription('http://push.test/device-2', 'key', 'secret', '') $$,
  '22023', null,
  'a device needs an https endpoint'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select is(
  (select count(*)::int from push_subscriptions where endpoint like 'https://push.test/%'),
  0,
  'another account can''t see the device'
);
select remove_push_subscription('https://push.test/device-1');
reset role;
select is(
  (select account_id from push_subscriptions where endpoint = 'https://push.test/device-1'),
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'nor turn it off'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select save_push_subscription('https://push.test/device-1', 'key3', 'secret3', 'Chrome');
reset role;
select is(
  (select account_id from push_subscriptions where endpoint = 'https://push.test/device-1'),
  '00000000-0000-0000-0000-0000000000a2'::uuid,
  'turning push on from another account moves the device there'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select remove_push_subscription('https://push.test/device-1');
reset role;
select is(
  (select count(*)::int from push_subscriptions where endpoint = 'https://push.test/device-1'),
  0,
  'its account turns it off'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select throws_ok(
  $$ select save_push_subscription('https://push.test/device-3', 'key', 'secret', '') $$,
  '42501', null,
  'an Inactive account can''t turn push on'
);
reset role;

select * from finish();
rollback;

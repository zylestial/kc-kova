-- Phone notifications (0071): signing out pauses a device, a paused device
-- gets no pushes, and signing back in un-pauses it and says since when.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'pauser@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'other@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'pauser', 'Paula Pauser', 'Requester'),
  ('00000000-0000-0000-0000-0000000000c2', 'otherone', 'Oscar Other', 'Requester');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.queued() returns int language sql as $$
  select count(*)::int from net.http_request_queue where url = 'https://kova.test/api/push/send';
$$;
-- A dev database may have real ones; this transaction rolls back.
delete from vault.secrets where name in ('push_send_url', 'push_send_secret');
select vault.create_secret('https://kova.test/api/push/send', 'push_send_url');
select vault.create_secret('test-secret', 'push_send_secret');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select is(
  save_push_subscription('https://push.test/c1', 'key', 'secret', ''),
  null,
  'a new device wasn''t paused'
);
select pause_push_subscription('https://push.test/c1');
reset role;
select isnt((select paused_at from push_subscriptions where endpoint = 'https://push.test/c1'), null, 'signing out pauses it');

select notify('00000000-0000-0000-0000-0000000000c1', 'REQUEST_SCHEDULED', 'Scheduled');
select is(pg_temp.queued(), 0, 'a paused device gets no push');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
select pause_push_subscription('https://push.test/c1');
reset role;
select is(
  (select account_id from push_subscriptions where endpoint = 'https://push.test/c1'),
  '00000000-0000-0000-0000-0000000000c1'::uuid,
  'another account can''t pause it'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select isnt(
  save_push_subscription('https://push.test/c1', 'key', 'secret', ''),
  null,
  'signing back in says when it was paused'
);
reset role;
select is((select paused_at from push_subscriptions where endpoint = 'https://push.test/c1'), null, 'and un-pauses it');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select pause_push_subscription('https://push.test/c1');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
select is(
  save_push_subscription('https://push.test/c1', 'key', 'secret', ''),
  null,
  'another account taking the device over doesn''t catch up on the first one''s'
);
reset role;

select * from finish();
rollback;

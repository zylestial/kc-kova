-- Phone notifications (0070): a new notification is queued for
-- /api/push/send only when its recipient has a device and the URL and secret
-- are set, and never breaks the action that made it.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'pushed@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'nodevice@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'pushed', 'Pia Pushed', 'Requester'),
  ('00000000-0000-0000-0000-0000000000b2', 'nodevice', 'Nico No-device', 'Requester');
insert into push_subscriptions (account_id, endpoint, p256dh, auth) values
  ('00000000-0000-0000-0000-0000000000b1', 'https://push.test/b1', 'key', 'secret');

create function pg_temp.queued() returns int language sql as $$
  select count(*)::int from net.http_request_queue where url = 'https://kova.test/api/push/send';
$$;

-- Nothing is set up yet. A dev database may have real ones; this
-- transaction rolls back.
delete from vault.secrets where name in ('push_send_url', 'push_send_secret');
select lives_ok(
  $$ select notify('00000000-0000-0000-0000-0000000000b1', 'REQUEST_SCHEDULED', 'Scheduled') $$,
  'a notification is made while push isn''t set up'
);
select is(pg_temp.queued(), 0, 'and nothing is queued');

select vault.create_secret('https://kova.test/api/push/send', 'push_send_url');
select vault.create_secret('test-secret', 'push_send_secret');

select notify('00000000-0000-0000-0000-0000000000b2', 'REQUEST_SCHEDULED', 'Scheduled');
select is(pg_temp.queued(), 0, 'nothing is queued for an account with no device');

select notify('00000000-0000-0000-0000-0000000000b1', 'REQUEST_SCHEDULED', 'Scheduled');
select is(pg_temp.queued(), 1, 'one request is queued for an account with a device');
select is(
  (select headers ->> 'Authorization' from net.http_request_queue where url = 'https://kova.test/api/push/send'),
  'Bearer test-secret',
  'carrying the secret'
);

select * from finish();
rollback;

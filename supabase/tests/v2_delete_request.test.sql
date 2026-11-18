-- A Scheduler or Admin deletes a request permanently (0091_delete_request.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000da', 'ana@test.local'),
  ('00000000-0000-0000-0000-0000000000db', 'sam@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000000da', 'anad', 'Ana Dizon', 'Requester'),
  ('00000000-0000-0000-0000-0000000000db', 'samd', 'Sam D', 'Scheduler');
insert into booking_options ("group", id, name, status) values
  ('projects', 'dp', 'Riverside Townhomes', 'Active'),
  ('destinations', 'dd', 'Wilcon Depot', 'Active'),
  ('purposes', 'dv', 'Site visit', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.stop() returns jsonb language sql as $$
  select jsonb_build_object('projectId', 'dp', 'destinationId', 'dd', 'purposeId', 'dv', 'flexibility', 'DAY');
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;

-- Ana asks for two stops tomorrow; then the day passes (dates moved back by hand).
select pg_temp.act_as('00000000-0000-0000-0000-0000000000da');
insert into ids select 'g', (create_request_group('DAILY', jsonb_build_object(
  'date', (now() at time zone 'Asia/Manila')::date + 1,
  'stops', jsonb_build_array(pg_temp.stop(), pg_temp.stop())))).id;
insert into ids select 'a', id from requests where group_id = pg_temp.id('g') and stop_letter = 'A';
insert into ids select 'b', id from requests where group_id = pg_temp.id('g') and stop_letter = 'B';
reset role;
update requests set requested_date = requested_date - 5 where group_id = pg_temp.id('g');
select notify('00000000-0000-0000-0000-0000000000da', 'REQUEST_MOVED', 'test', pg_temp.id('a'));

select throws_ok(
  format('select delete_request(%L)', pg_temp.id('a')), '42501',
  'Only a Scheduler or Admin can delete a request', 'A requester cannot delete');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000db');
select throws_ok(
  format('select delete_request(%L)', gen_random_uuid()), 'P0002', 'Request not found', 'An unknown request');
select lives_ok(format('select delete_request(%L)', pg_temp.id('a')), 'A Scheduler deletes stop A');
reset role;
select is((select count(*)::int from requests where id = pg_temp.id('a')), 0, 'Stop A is gone');
select is((select count(*)::int from request_destinations where request_id = pg_temp.id('a')), 0, 'with its destinations');
select is((select count(*)::int from notifications where related_request_id = pg_temp.id('a')), 0, 'and its notifications');
select is((select count(*)::int from notifications where type = 'REQUEST_CANCELLED'
  and account_id = '00000000-0000-0000-0000-0000000000da'), 0, 'Ana is not told');
select is((select row_version from request_groups where id = pg_temp.id('g')), 2, 'The request stays for stop B, its version up');
select ok((select count(*) > 0 from audit_events where record_id = pg_temp.id('a') and action = 'request.delete'
  and actor_account_id = '00000000-0000-0000-0000-0000000000db' and after is null and before is not null),
  'The audit log keeps the deleted stop and who deleted it');

-- A missed stop (it was on a trip) can't be deleted.
update requests set missed_at = now() where id = pg_temp.id('b');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000db');
select throws_ok(
  format('select delete_request(%L)', pg_temp.id('b')), '22023',
  'This stop was on a trip, so it can''t be deleted. Send it back or move it instead', 'A missed stop stays');
reset role;
update requests set missed_at = null where id = pg_temp.id('b');

-- The last stop takes its request group with it.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000db');
select lives_ok(format('select delete_request(%L)', pg_temp.id('b')), 'Stop B is deleted too');
reset role;
select is((select count(*)::int from request_groups where id = pg_temp.id('g')), 0, 'and the empty request is gone');
select is((select count(*)::int from audit_events where record_id = pg_temp.id('g') and action = 'request.delete'
  and table_name = 'request_groups' and after is null), 1, 'its deletion is in the audit log');

select * from finish();

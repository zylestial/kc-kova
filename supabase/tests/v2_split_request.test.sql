-- v2.4: splitting stops a vehicle can't fit off into a new request
-- (0039_split_request.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000006a', 'juan6@test.local'),
  ('00000000-0000-0000-0000-00000000006d', 'sched6@test.local'),
  ('00000000-0000-0000-0000-00000000006e', 'driver6@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000006a', 'juan6', 'Juan Six', 'Requester'),
  ('00000000-0000-0000-0000-00000000006d', 'sched6', 'Sam Six', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000006e', 'driver6', 'Dee Six', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V66', 'Van 66', '00000000-0000-0000-0000-00000000006e');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd61', 'City Hall 61', 'Active'),
  ('destinations', 'd62', 'Port Office 62', 'Active'),
  ('purposes', 'p66', 'Inspection', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date + 10;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000006a');
select create_request(pg_temp.d(), 'REGULAR', null, 'Site 6',
  '[{"destinationId":"d61","purposeId":"p66"},{"destinationId":"d62","purposeId":"p66"}]', 'V66');
reset role;

create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
insert into ids select 'juan', id from requests where owner_account_id = '00000000-0000-0000-0000-00000000006a';
insert into ids select 'ch', id from request_destinations where request_id = (select v from ids where k = 'juan') and destination_id = 'd61';
insert into ids select 'po', id from request_destinations where request_id = (select v from ids where k = 'juan') and destination_id = 'd62';
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.legs() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('destinationId', 'd61', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
      'stops', jsonb_build_array(pg_temp.id('ch'))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30'));
$$;
create function pg_temp.rv() returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = pg_temp.id('sched') and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;

-- Who may split ------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000006a');
select throws_ok(
  $$ select split_request(pg_temp.id('juan'), array[pg_temp.id('po')]) $$,
  '42501', 'Only a Scheduler can split requests',
  'A Requester cannot split a request');

-- Only City Hall fits on this vehicle: the draft holds half the request ----
select pg_temp.act_as('00000000-0000-0000-0000-00000000006d');
select save_schedule_draft(null, null, pg_temp.d(), 'V66', array[pg_temp.id('juan')], pg_temp.legs());
insert into ids select 'sched', id from schedules where created_by_account_id = '00000000-0000-0000-0000-00000000006d';
select throws_ok(
  format($$ select submit_schedule(%L::uuid, %s) $$, pg_temp.id('sched'), pg_temp.rv()),
  '22023', 'Every destination of every included request must be on a leg',
  'A half-placed request blocks submit until it is split');

select throws_ok(
  $$ select split_request(pg_temp.id('juan'), array[pg_temp.id('ch')]) $$,
  '22023', 'A stop being split off is already on a route. Reload and try again',
  'A stop already on a route cannot be split off');
select throws_ok(
  $$ select split_request(pg_temp.id('juan'), array[pg_temp.id('ch'), pg_temp.id('po')]) $$,
  '22023', 'Keep at least one stop on the original request',
  'Splitting every stop off is refused');

-- Split Port Office off ----------------------------------------------------
select lives_ok(
  $$ select split_request(pg_temp.id('juan'), array[pg_temp.id('po')]) $$,
  'The unplaced stop is split off');
insert into ids select 'split', id from requests
  where owner_account_id = '00000000-0000-0000-0000-00000000006a' and id <> pg_temp.id('juan');

select is(
  (select array_agg(destination_id) from request_destinations where request_id = pg_temp.id('juan') and active),
  array['d61'], 'The original keeps only City Hall');
select is(
  (select array_agg(destination_id || '@' || position) from request_destinations where request_id = pg_temp.id('split') and active),
  array['d62@1'], 'The new request has Port Office, as its first stop');
select is(
  (select row(owner_account_id, requested_date, request_type, project_name)::text from requests where id = pg_temp.id('split')),
  (select row(owner_account_id, requested_date, request_type, project_name)::text from requests where id = pg_temp.id('juan')),
  'The new request has the same requester, date, type and project');
select is(
  (select progress from request_progress where request_id = pg_temp.id('split')), 'NOT_YET_SCHEDULED',
  'The split-off request waits in the pool');

select lives_ok(
  format($$ select submit_schedule(%L::uuid, %s) $$, pg_temp.id('sched'), pg_temp.rv()),
  'With the rest split off, the schedule submits');
select lives_ok(
  $$ select send_back_requests(array[pg_temp.id('split')], 'No room for Port Office') $$,
  'The split-off request can be sent back');

reset role;
select is(
  (select count(*)::int from notifications
   where account_id = '00000000-0000-0000-0000-00000000006a' and type = 'REQUEST_SPLIT' and related_request_id = pg_temp.id('split')),
  1, 'The requester is told about the split');

select * from finish();
rollback;

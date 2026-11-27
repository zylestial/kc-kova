-- Company trip Drivers (0079_company_trip_drivers.sql): anyone with "Can
-- drive company trips" can be a Company trip's Driver, the requester too,
-- and the Driver records it. A trip started under the old rule can still be
-- finished by whoever started it.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- These test other rules, so taps here read as made before tasks at a stop (0088);
-- v2_stop_tasks.test.sql tests that rule.
alter table stop_taps alter column before_tasks set default true;
alter table company_trip_runs alter column before_tasks set default true;

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000002a1', 'rhea4@test.local'),
  ('00000000-0000-0000-0000-0000000002a2', 'liza4@test.local'),
  ('00000000-0000-0000-0000-0000000002a3', 'sam4@test.local'),
  ('00000000-0000-0000-0000-0000000002a4', 'ada4@test.local'),
  ('00000000-0000-0000-0000-0000000002a5', 'tom4@test.local');
-- Rhea may request and drive; Liza may drive; nobody switched Ada on.
insert into accounts (id, username, name, role, position, can_request_company, can_drive_company) values
  ('00000000-0000-0000-0000-0000000002a1', 'rhea4', 'Rhea Santos', 'Requester', 'Purchasing Officer', true, true);
insert into accounts (id, username, name, role, can_drive_company) values
  ('00000000-0000-0000-0000-0000000002a2', 'liza4', 'Liza Mendoza', 'Requester', true),
  ('00000000-0000-0000-0000-0000000002a3', 'sam4', 'Sam D', 'Scheduler', false),
  ('00000000-0000-0000-0000-0000000002a4', 'ada4', 'Ada Admin', 'Admin', false);
insert into accounts (id, username, name, role, driver_type) values
  ('00000000-0000-0000-0000-0000000002a5', 'tom4', 'Tom Cruz', 'Driver', 'Truck');
insert into vehicles (plate, name, company_trips) values ('TD', 'Vios', true);
insert into booking_options ("group", id, name, status) values
  ('projects', 'dp', 'Head office', 'Active'),
  ('destinations', 'dd1', 'BIR RDO 43', 'Active'),
  ('purposes', 'dpu', 'Submission', 'Active'),
  ('departments', 'ddep', 'Accounting', 'Active'),
  ('supervisors', 'dsup', 'Engr. Dante Villanueva', 'Active'),
  ('heads', 'dh', 'Engr. Carmela Ong', 'Active');
-- Every Company trip starts at the Main Office (0094).
insert into booking_options ("group", id, name, status) values ('starting_points', 'start-office', 'Main Office', 'Active')
on conflict ("group", id) do update set status = 'Active';

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
-- The requester books the trip (0094): sending it goes to the Admin.
create function pg_temp.ask(p_driver uuid, p_out text default '08:00', p_in text default '08:30') returns uuid language sql as $$
  select (request_company_trip(null, null, jsonb_build_object(
    'date', (now() at time zone 'Asia/Manila')::date, 'departmentId', 'dp', 'vehiclePlate', 'TD',
    'driverId', p_driver, 'purpose', 'Submission', 'fleetCard', '1234', 'timeOut', p_out,
    'stops', jsonb_build_array(jsonb_build_object('destinationId', 'dd1', 'arriveAt', p_in))))).id;
$$;
-- Ada approves the request's trip.
create function pg_temp.plan(p_group uuid) returns uuid language plpgsql as $$
declare v_trip uuid;
begin
  select sr.schedule_id into v_trip from public.schedule_requests sr join public.requests r on r.id = sr.request_id
  where r.group_id = p_group limit 1;
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000002a4');
  perform public.approve_schedule(v_trip, (select row_version from public.schedule_revisions where schedule_id = v_trip and status = 'SUBMITTED'));
  return v_trip;
end;
$$;

-- Who can be the Driver --------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a1');
select throws_ok($$ select pg_temp.ask('00000000-0000-0000-0000-0000000002a4') $$, '22023',
  'Select someone who can drive company trips', 'Not someone who isn''t allowed to drive');
select throws_ok($$ select pg_temp.ask('00000000-0000-0000-0000-0000000002a5') $$, '22023',
  'Select someone who can drive company trips', 'Never a Truck driver');
select lives_ok($$ insert into ids select 'self', pg_temp.ask('00000000-0000-0000-0000-0000000002a1', '13:00', '13:30') $$,
  'Rhea picks herself as the Driver');
select lives_ok($$ insert into ids select 'liza', pg_temp.ask('00000000-0000-0000-0000-0000000002a2') $$,
  'Rhea picks Liza, a Requester who can drive');

-- Approved, and recorded by its Driver ----------------------------------
reset role;
insert into ids select 'trip', pg_temp.plan(pg_temp.id('liza'));
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a1');
select throws_ok($$ select start_company_trip(pg_temp.id('trip'), 1000) $$, 'P0002', 'Trip not found',
  'The requester doesn''t record a trip someone else drives');
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a2');
select lives_ok($$ select start_company_trip(pg_temp.id('trip'), 1000) $$, 'Liza, its Driver, starts it');

-- Started under the old rule ------------------------------------------------
reset role;
insert into ids select 'old', pg_temp.plan(pg_temp.id('self'));
reset role;
update schedule_revisions set driver_id = '00000000-0000-0000-0000-0000000002a2'
where schedule_id = pg_temp.id('old');
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a1');
select throws_ok($$ select start_company_trip(pg_temp.id('old'), 2000) $$, 'P0002', 'Trip not found',
  'Rhea no longer drives it, so she can''t start it');
reset role;
insert into company_trip_runs (schedule_id, revision_id, start_odometer, started_by_account_id)
select pg_temp.id('old'), published_revision_id, 2000, '00000000-0000-0000-0000-0000000002a1'
from schedules where id = pg_temp.id('old');
select pg_temp.act_as('00000000-0000-0000-0000-0000000002a1');
select lives_ok($$ select end_company_trip(pg_temp.id('old'), 2010) $$, 'Whoever started it can still end it');

select * from finish();
rollback;

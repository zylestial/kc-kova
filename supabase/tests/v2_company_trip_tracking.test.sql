-- The Driver records the Company trip (0079; the requester did in 0055):
-- Start trip with the odometer, Arrived / Leaving in route order, End trip
-- at the last stop, not in Attendance (0055_company_trip_tracking.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- These test other rules, so taps here read as made before tasks at a stop (0088);
-- v2_stop_tasks.test.sql tests that rule.
alter table stop_taps alter column before_tasks set default true;
alter table company_trip_runs alter column before_tasks set default true;

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000001a1', 'rhea3@test.local'),
  ('00000000-0000-0000-0000-0000000001a2', 'liza3@test.local'),
  ('00000000-0000-0000-0000-0000000001a3', 'sam3@test.local'),
  ('00000000-0000-0000-0000-0000000001a4', 'ada3@test.local'),
  ('00000000-0000-0000-0000-0000000001a5', 'jun3@test.local');
insert into accounts (id, username, name, role, position, can_request_company) values
  ('00000000-0000-0000-0000-0000000001a1', 'rhea3', 'Rhea Santos', 'Requester', 'Purchasing Officer', true);
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000001a2', 'liza3', 'Liza Mendoza', 'Requester'),
  ('00000000-0000-0000-0000-0000000001a3', 'sam3', 'Sam D', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000001a4', 'ada3', 'Ada Admin', 'Admin');
insert into accounts (id, username, name, role, driver_type) values
  ('00000000-0000-0000-0000-0000000001a5', 'jun3', 'Jun Reyes', 'Driver', 'Company car');
insert into vehicles (plate, name, company_trips) values ('TM', 'Mirage', true);
insert into booking_options ("group", id, name, status) values
  ('projects', 'tp', 'Head office', 'Active'),
  ('destinations', 'td1', 'BIR RDO 43', 'Active'),
  ('destinations', 'td2', 'BDO Ortigas', 'Active'),
  ('purposes', 'tpu', 'Submission', 'Active'),
  ('departments', 'tdep', 'Accounting', 'Active'),
  ('starting_points', 'tsp', 'Main Office', 'Active'),
  ('supervisors', 'tsup', 'Engr. Dante Villanueva', 'Active'),
  ('heads', 'th', 'Engr. Carmela Ong', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.leg(p_no int) returns uuid language sql as $$
  select l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id('trip') and l.leg_no = p_no;
$$;

-- Rhea books two stops with Jun driving (0094); Ada approves it.
insert into booking_options ("group", id, name, status) values ('starting_points', 'start-office', 'Main Office', 'Active')
on conflict ("group", id) do update set status = 'Active';
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
insert into ids select 'g', (request_company_trip(null, null, jsonb_build_object(
  'date', (now() at time zone 'Asia/Manila')::date, 'departmentId', 'tp', 'vehiclePlate', 'TM',
  'driverId', '00000000-0000-0000-0000-0000000001a5', 'purpose', 'Submission', 'fleetCard', '1234', 'timeOut', '08:00',
  'stops', jsonb_build_array(
    jsonb_build_object('destinationId', 'td1', 'arriveAt', '08:30', 'leaveAt', '09:00'),
    jsonb_build_object('destinationId', 'td2', 'arriveAt', '09:30'))))).id;
reset role;
insert into ids select 'trip', sr.schedule_id from schedule_requests sr join requests r on r.id = sr.request_id
where r.group_id = pg_temp.id('g') limit 1;
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a4');
select approve_schedule(pg_temp.id('trip'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('trip') and status = 'SUBMITTED'));

-- Who records it -------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a5');
select throws_ok($$ select record_trip_attendance(pg_temp.id('trip'), 'START') $$, '22023',
  'A Company trip is recorded by its requester, not in Attendance', 'The Driver''s Start trip refuses a Company trip');
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
select throws_ok($$ select start_company_trip(pg_temp.id('trip'), 48215) $$, 'P0002', 'Trip not found', 'The requester doesn''t record it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select throws_ok($$ select start_company_trip(pg_temp.id('trip'), 48215) $$, 'P0002', 'Trip not found', 'Another requester can''t either');

-- Not before its date (0056) ---------------------------------------------------
reset role;
update schedules set schedule_date = schedule_date + 1 where id = pg_temp.id('trip');
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a5');
select throws_ok($$ select start_company_trip(pg_temp.id('trip'), 48215) $$, '22023',
  'This trip can''t be started before its date', 'Start trip waits for the trip''s date');
reset role;
update schedules set schedule_date = schedule_date - 1 where id = pg_temp.id('trip');

-- In route order ------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a5');
select throws_ok($$ select record_company_stop(pg_temp.id('trip'), pg_temp.leg(1), 'ARRIVE') $$, '22023', 'Tap Start trip first',
  'Nothing before Start trip');
select throws_ok($$ select start_company_trip(pg_temp.id('trip'), -1) $$, '22023',
  'Enter the starting odometer reading, in whole kilometres', 'A negative reading is refused');
select lives_ok($$ select start_company_trip(pg_temp.id('trip'), null) $$, 'Jun starts the trip before typing the odometer (0090)');
select lives_ok($$ select set_start_odometer(pg_temp.id('trip'), 48215) $$, 'and enters it after');
select throws_ok($$ select record_company_stop(pg_temp.id('trip'), pg_temp.leg(1), 'LEAVE') $$, '22023', 'Tap Arrived at this stop first',
  'Leaving needs Arrived first');
select lives_ok($$ select record_company_stop(pg_temp.id('trip'), pg_temp.leg(1), 'ARRIVE') $$, 'Arrived at the first stop');
select throws_ok($$ select end_company_trip(pg_temp.id('trip'), 48262) $$, '22023', 'Tap Leaving the stop before the last one first',
  'End trip needs Leaving the stop before');
select lives_ok($$ select record_company_stop(pg_temp.id('trip'), pg_temp.leg(1), 'LEAVE') $$, 'Leaving the first stop');
select throws_ok($$ select record_company_stop(pg_temp.id('trip'), pg_temp.leg(2), 'ARRIVE') $$, '22023',
  'Tap End trip on arriving at the last stop', 'The last stop is reached with End trip');
select throws_ok($$ select end_company_trip(pg_temp.id('trip'), 48000) $$, '22023',
  'Enter the ending odometer reading; it can''t be lower than the start (48215 km)', 'The ending odometer can''t be lower');
select lives_ok($$ select end_company_trip(pg_temp.id('trip'), 48262) $$, 'End trip at the last stop');

-- What it leaves ------------------------------------------------------------
reset role;
select is((select distance from trip_completions where schedule_id = pg_temp.id('trip')), 47, 'The trip is submitted with 47 km');
select is((select count(*)::int from trip_attendance where schedule_id = pg_temp.id('trip')), 0, 'Nothing is in Attendance');
select is(trip_times_missing(pg_temp.id('trip')), 0, 'Every Time Out and Time In of the form is filled');

select * from finish();
rollback;

-- The Driver records the Company trip (0079; the requester did in 0055):
-- Start trip with the odometer, Arrived / Leaving in route order, End trip
-- at the last stop, not in Attendance (0055_company_trip_tracking.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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

-- Rhea asks for two stops; Sam plans them as one trip; Ada approves it.
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
insert into ids select 'g', (create_request_group('COMPANY', jsonb_build_object(
  'date', (now() at time zone 'Asia/Manila')::date, 'startingPointId', 'tsp', 'departmentId', 'tdep', 'vehiclePlate', 'TM',
  'driverId', '00000000-0000-0000-0000-0000000001a5', 'supervisorId', 'tsup', 'headId', 'th',
  'stops', jsonb_build_array(
    jsonb_build_object('projectId', 'tp', 'destinationId', 'td1', 'purposeId', 'tpu'),
    jsonb_build_object('projectId', 'tp', 'destinationId', 'td2', 'purposeId', 'tpu'))))).id;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a3');
insert into ids select 'trip', (create_company_trip((now() at time zone 'Asia/Manila')::date, 'TM',
  array(select id from requests where group_id = pg_temp.id('g') order by stop_letter),
  (select jsonb_agg(jsonb_build_object('destinationId', rd.destination_id, 'plannedTimeOut', t.out, 'plannedTimeIn', t.inn,
     'stops', jsonb_build_array(rd.id)) order by r.stop_letter)
   from requests r join request_destinations rd on rd.request_id = r.id and rd.active
   join (values ('A', '08:00', '08:30'), ('B', '09:00', '09:30')) as t (letter, out, inn) on t.letter = r.stop_letter
   where r.group_id = pg_temp.id('g')))).schedule_id;
select submit_schedule(pg_temp.id('trip'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('trip')));
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
select throws_ok($$ select start_company_trip(pg_temp.id('trip'), null) $$, '22023',
  'Enter the starting odometer reading, in whole kilometres', 'Start trip needs the odometer');
select lives_ok($$ select start_company_trip(pg_temp.id('trip'), 48215) $$, 'Jun starts the trip with the odometer');
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

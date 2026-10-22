-- Vehicles without an odometer (0078): "Has an odometer" off means a
-- trip records no readings (Daily Complete trip, Company Start/End trip);
-- a vehicle with one still needs both. A trip has both readings or none.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'admin7@test.local'),
  ('00000000-0000-0000-0000-0000000007a2', 'sched7@test.local'),
  ('00000000-0000-0000-0000-0000000007a3', 'driver7a@test.local'),
  ('00000000-0000-0000-0000-0000000007a4', 'driver7b@test.local'),
  ('00000000-0000-0000-0000-0000000007a5', 'rhea7@test.local'),
  ('00000000-0000-0000-0000-0000000007a6', 'jun7@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000007a1', 'admin7', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-0000000007a2', 'sched7', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000007a3', 'driver7a', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-0000000007a4', 'driver7b', 'Dee Driver', 'Driver');
insert into accounts (id, username, name, role, position, can_request_company) values
  ('00000000-0000-0000-0000-0000000007a5', 'rhea7', 'Rhea Santos', 'Requester', 'Purchasing Officer', true);
insert into accounts (id, username, name, role, driver_type) values
  ('00000000-0000-0000-0000-0000000007a6', 'jun7', 'Jun Reyes', 'Driver', 'Company car');
insert into vehicles (plate, name, assigned_driver_id) values
  ('W1', 'Van 1', '00000000-0000-0000-0000-0000000007a3'),
  ('W2', 'Van 2', '00000000-0000-0000-0000-0000000007a4');
insert into vehicles (plate, name, company_trips) values ('WM', 'Mirage', true);
insert into booking_options ("group", id, name, status) values
  ('destinations', 'wd1', 'City Hall', 'Active'),
  ('destinations', 'wd2', 'BDO Ortigas', 'Active'),
  ('purposes', 'wp1', 'Inspection', 'Active'),
  ('projects', 'wpr', 'Head office', 'Active'),
  ('departments', 'wdep', 'Accounting', 'Active'),
  ('starting_points', 'wsp', 'Main Office', 'Active'),
  ('supervisors', 'wsup', 'Engr. Dante Villanueva', 'Active'),
  ('heads', 'wh', 'Engr. Carmela Ong', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.yesterday() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date - 1;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.leg(p_schedule text, p_no int) returns uuid language sql as $$
  select l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id(p_schedule) and l.leg_no = p_no;
$$;
create function pg_temp.rv(p_schedule uuid) returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = p_schedule and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
insert into ids select 'r1', id from create_request(pg_temp.yesterday(), 'REGULAR', null, null, '[{"destinationId":"wd1","purposeId":"wp1"}]', null);
insert into ids select 'r2', id from create_request(pg_temp.yesterday(), 'REGULAR', null, null, '[{"destinationId":"wd1","purposeId":"wp1"}]', null);
reset role;
insert into ids select k || '_rd', (select id from request_destinations where request_id = v and active) from ids;

create function pg_temp.publish(p_plate text, p_request text) returns uuid language plpgsql as $$
declare
  v_revision schedule_revisions;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000007a2');
  select * into v_revision from save_schedule_draft(null, null, pg_temp.yesterday(), p_plate, array[pg_temp.id(p_request)],
    jsonb_build_array(
      jsonb_build_object('destinationId', 'wd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
        'stops', jsonb_build_array(pg_temp.id(p_request || '_rd'))),
      jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30')));
  perform submit_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
  perform approve_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  reset role;
  return v_revision.schedule_id;
end;
$$;
-- s1: Dan (W1), yesterday. s2: Dee (W2), yesterday.
insert into ids values ('s1', pg_temp.publish('W1', 'r1'));
insert into ids values ('s2', pg_temp.publish('W2', 'r2'));

-- Company trips ------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a5');
insert into ids select 'g', (create_request_group('COMPANY', jsonb_build_object(
  'date', (now() at time zone 'Asia/Manila')::date, 'startingPointId', 'wsp', 'departmentId', 'wdep', 'vehiclePlate', 'WM',
  'driverId', '00000000-0000-0000-0000-0000000007a6', 'supervisorId', 'wsup', 'headId', 'wh',
  'stops', jsonb_build_array(
    jsonb_build_object('projectId', 'wpr', 'destinationId', 'wd1', 'purposeId', 'wp1'),
    jsonb_build_object('projectId', 'wpr', 'destinationId', 'wd2', 'purposeId', 'wp1'))))).id;
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a2');
insert into ids select 'trip', (create_company_trip((now() at time zone 'Asia/Manila')::date, 'WM',
  array(select id from requests where group_id = pg_temp.id('g') order by stop_letter),
  (select jsonb_agg(jsonb_build_object('destinationId', rd.destination_id, 'plannedTimeOut', t.out, 'plannedTimeIn', t.inn,
     'stops', jsonb_build_array(rd.id)) order by r.stop_letter)
   from requests r join request_destinations rd on rd.request_id = r.id and rd.active
   join (values ('A', '08:00', '08:30'), ('B', '09:00', '09:30')) as t (letter, out, inn) on t.letter = r.stop_letter
   where r.group_id = pg_temp.id('g')))).schedule_id;
select submit_schedule(pg_temp.id('trip'), pg_temp.rv(pg_temp.id('trip')));
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select approve_schedule(pg_temp.id('trip'), pg_temp.rv(pg_temp.id('trip')));
reset role;
-- Yesterday, so a few hours back is still on the trip's day.
update schedules set schedule_date = pg_temp.yesterday() where id = pg_temp.id('trip');

-- W2 and the Mirage have no odometer; W1 has one.
update vehicles set has_odometer = false where plate in ('W2', 'WM');

-- The switch ------------------------------------------------------------------
select is((select has_odometer from vehicles where plate = 'W1'), true, 'A vehicle has an odometer unless turned off');
select ok(not has_function_privilege('authenticated', 'vehicle_has_odometer(text)', 'execute'), 'vehicle_has_odometer is internal');

-- Daily trips ----------------------------------------------------------------
create function pg_temp.drive(p_driver uuid, p_schedule text) returns void language plpgsql as $$
begin
  perform pg_temp.act_as(p_driver);
  perform record_trip_attendance(pg_temp.id(p_schedule), 'START');
  perform record_stop_tap(pg_temp.id(p_schedule), pg_temp.leg(p_schedule, 1), 'ARRIVE');
  perform record_stop_tap(pg_temp.id(p_schedule), pg_temp.leg(p_schedule, 1), 'LEAVE');
  perform record_trip_attendance(pg_temp.id(p_schedule), 'END');
end;
$$;
select pg_temp.drive('00000000-0000-0000-0000-0000000007a3', 's1');
select throws_ok($$ select submit_completion(pg_temp.id('s1'), null, null) $$, '22023',
  'Enter whole-number odometer readings, with the end no lower than the start',
  'A vehicle with an odometer still needs both readings');
select lives_ok($$ select submit_completion(pg_temp.id('s1'), 1000, 1042) $$, 'and completes with them');
reset role;
select is((select end_odometer from trip_completions where schedule_id = pg_temp.id('s1')), 1042, 'Its readings are kept');

select pg_temp.drive('00000000-0000-0000-0000-0000000007a4', 's2');
select lives_ok($$ select submit_completion(pg_temp.id('s2'), 500, 480, true) $$,
  'A vehicle without one completes, whatever readings come with it');
reset role;
select is((select start_odometer from trip_completions where schedule_id = pg_temp.id('s2')), null, 'No start reading is saved');
select is((select end_odometer from trip_completions where schedule_id = pg_temp.id('s2')), null, 'nor an end reading');
select is((select full_tank from trip_completions where schedule_id = pg_temp.id('s2')), true, 'The fuel checks still are');

select throws_ok($$ update trip_completions set end_odometer = 12 where schedule_id = pg_temp.id('s2') $$, '23514', null,
  'A trip can''t have one reading without the other');

-- Company trips --------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a6');
select lives_ok($$ select start_company_trip(pg_temp.id('trip'), null) $$, 'A Company trip without an odometer starts with no reading');
select record_company_stop(pg_temp.id('trip'), pg_temp.leg('trip', 1), 'ARRIVE');
select record_company_stop(pg_temp.id('trip'), pg_temp.leg('trip', 1), 'LEAVE');
reset role;
-- Turning the switch on mid-trip doesn't ask for an end reading.
update vehicles set has_odometer = true where plate = 'WM';
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a6');
select lives_ok($$ select end_company_trip(pg_temp.id('trip'), null) $$, 'and ends with none, following its start');
reset role;
select is((select array[start_odometer, end_odometer] from company_trip_runs where schedule_id = pg_temp.id('trip')), array[null, null]::int[],
  'The run has no readings');
select is((select array[start_odometer, end_odometer] from trip_completions where schedule_id = pg_temp.id('trip')), array[null, null]::int[],
  'and nor does its completion');
select is((select end_at is not null from company_trip_runs where schedule_id = pg_temp.id('trip')), true, 'The trip ended');

-- With the switch back on, a new start needs its reading.
reset role;
delete from trip_completions where schedule_id = pg_temp.id('trip');
delete from stop_taps where schedule_id = pg_temp.id('trip');
delete from company_trip_runs where schedule_id = pg_temp.id('trip');
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a6');
select throws_ok($$ select start_company_trip(pg_temp.id('trip'), null) $$, '22023',
  'Enter the starting odometer reading, in whole kilometres', 'A Company trip with an odometer needs the start reading');

select * from finish();
rollback;

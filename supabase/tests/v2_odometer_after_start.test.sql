-- The starting odometer after Start trip (0090): set_start_odometer saves a
-- Daily trip's reading on its attendance until Complete trip, and only for
-- its Driver or an Admin, on a vehicle with an odometer. (Company trips:
-- v2_company_trip_tracking and v2_vehicles_without_odometer.)
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

alter table stop_taps alter column before_tasks set default true;

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000009a1', 'admin9@test.local'),
  ('00000000-0000-0000-0000-0000000009a2', 'sched9@test.local'),
  ('00000000-0000-0000-0000-0000000009a3', 'driver9a@test.local'),
  ('00000000-0000-0000-0000-0000000009a4', 'driver9b@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000009a1', 'admin9', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-0000000009a2', 'sched9', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000009a3', 'driver9a', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-0000000009a4', 'driver9b', 'Dee Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('X1', 'Van 1', '00000000-0000-0000-0000-0000000009a3'),
  ('X2', 'Van 2', '00000000-0000-0000-0000-0000000009a4');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'xd1', 'City Hall', 'Active'),
  ('purposes', 'xp1', 'Inspection', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
-- Yesterday: a Regular request today would need 7 days' notice, and the trip still starts.
create function pg_temp.trip_day() returns date language sql as $$ select (now() at time zone 'Asia/Manila')::date - 1; $$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.rv(p_schedule uuid) returns int language sql as $$
  select row_version from schedule_revisions where schedule_id = p_schedule and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
create function pg_temp.leg(p_schedule text, p_no int) returns uuid language sql as $$
  select l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id(p_schedule) and l.leg_no = p_no;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a1');
insert into ids select 'r1', id from create_request(pg_temp.trip_day(), 'REGULAR', null, null, '[{"destinationId":"xd1","purposeId":"xp1"}]', null);
insert into ids select 'r2', id from create_request(pg_temp.trip_day(), 'REGULAR', null, null, '[{"destinationId":"xd1","purposeId":"xp1"}]', null);
reset role;
insert into ids select k || '_rd', (select id from request_destinations where request_id = v and active) from ids;

create function pg_temp.publish(p_plate text, p_request text) returns uuid language plpgsql as $$
declare
  v_revision schedule_revisions;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000009a2');
  select * into v_revision from save_schedule_draft(null, null, pg_temp.trip_day(), p_plate, array[pg_temp.id(p_request)],
    jsonb_build_array(
      jsonb_build_object('destinationId', 'xd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
        'stops', jsonb_build_array(pg_temp.id(p_request || '_rd'))),
      jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30')));
  perform submit_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  perform pg_temp.act_as('00000000-0000-0000-0000-0000000009a1');
  perform approve_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  reset role;
  return v_revision.schedule_id;
end;
$$;
insert into ids values ('s1', pg_temp.publish('X1', 'r1'));
insert into ids values ('s2', pg_temp.publish('X2', 'r2'));
update vehicles set has_odometer = false where plate = 'X2';

-- Daily trip ------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000009a3');
select throws_ok($$ select set_start_odometer(pg_temp.id('s1'), 1000) $$, '22023', 'Tap Start trip first', 'Not before Start trip');
select record_trip_attendance(pg_temp.id('s1'), 'START');
select throws_ok($$ select set_start_odometer(pg_temp.id('s1'), -1) $$, '22023',
  'Enter the starting odometer reading, in whole kilometres', 'A reading must be a whole number, not negative');
select lives_ok($$ select set_start_odometer(pg_temp.id('s1'), 1000) $$, 'Dan enters the reading after Start trip');
select lives_ok($$ select set_start_odometer(pg_temp.id('s1'), 1001) $$, 'and can correct it');
reset role;
select is((select start_odometer from trip_attendance where schedule_id = pg_temp.id('s1')), 1001, 'It is kept on the attendance');

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a4');
select throws_ok($$ select set_start_odometer(pg_temp.id('s1'), 5) $$, '22023', 'Tap Start trip first', 'Another Driver can''t set it');
select record_trip_attendance(pg_temp.id('s2'), 'START');
select throws_ok($$ select set_start_odometer(pg_temp.id('s2'), 5) $$, '22023', 'This vehicle has no odometer',
  'Not on a vehicle without an odometer');

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a1');
select lives_ok($$ select set_start_odometer(pg_temp.id('s1'), 1002) $$, 'An Admin can set it for the Driver');

select pg_temp.act_as('00000000-0000-0000-0000-0000000009a3');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'LEAVE');
select record_trip_attendance(pg_temp.id('s1'), 'END');
select lives_ok($$ select submit_completion(pg_temp.id('s1'), 1002, 1040) $$, 'Complete trip still takes both readings');
select throws_ok($$ select set_start_odometer(pg_temp.id('s1'), 1003) $$, '22023',
  'This trip is completed; its readings can''t change here', 'Not after Complete trip');
reset role;
select ok(has_function_privilege('authenticated', 'set_start_odometer(uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'set_start_odometer(uuid, integer)', 'execute'), 'Signed-in accounts only');

select * from finish();
rollback;

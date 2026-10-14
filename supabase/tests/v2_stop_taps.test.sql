-- Stop times: record_stop_tap (Arrived / Leaving at each leg's destination),
-- who may tap, the Start-to-End window, the final leg, distance from the
-- destination's saved position, repeats, Admin override and who can read.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- These tests are about scheduling, not the vehicle a request names
-- (v2_request_vehicle.test.sql), so any vehicle may take any request here.
alter table revision_requests disable trigger revision_requests_request_vehicle;

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'juan@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-000000000010', 'driver2@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000b', 'juan', 'Juan', 'Requester'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-000000000010', 'driver2', 'Dee Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e'),
  ('V2', 'Van 2', '00000000-0000-0000-0000-000000000010');
-- d1 has a position (1 km north of ANONANG); d2 has none.
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd1', 'City Hall', 'Active'),
  ('destinations', 'd2', 'Market', 'Active'),
  ('purposes', 'p1', 'Inspection', 'Active');
insert into destination_locations (destination_id, lat, lng) values ('d1', 16.112769, 120.436222);

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.manila_today() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.rv(p_schedule uuid) returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = p_schedule and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
-- The id of leg p_no on the schedule's approved version.
create function pg_temp.leg(p_schedule text, p_no int) returns uuid language sql as $$
  select l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id(p_schedule) and l.leg_no = p_no;
$$;

-- Admin may file past-dated requests; a Requester needs 7 days' notice.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into ids select 'r1', id from create_request(pg_temp.manila_today() - 1, 'REGULAR', null, null,
  '[{"destinationId":"d1","purposeId":"p1"},{"destinationId":"d2","purposeId":"p1"}]', 'V1');
insert into ids select 'r2', id from create_request(pg_temp.manila_today() - 1, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', 'V1');
reset role;
insert into ids select 'r1_d1', id from request_destinations where request_id = pg_temp.id('r1') and position = 1;
insert into ids select 'r1_d2', id from request_destinations where request_id = pg_temp.id('r1') and position = 2;
insert into ids select 'r2_d1', id from request_destinations where request_id = pg_temp.id('r2') and active;

create function pg_temp.publish(p_plate text, p_request text, p_legs jsonb) returns uuid language plpgsql as $$
declare
  v_revision schedule_revisions;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
  select * into v_revision from save_schedule_draft(null, null, pg_temp.manila_today() - 1, p_plate,
    array[pg_temp.id(p_request)], p_legs);
  perform submit_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
  perform approve_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  reset role;
  return v_revision.schedule_id;
end;
$$;
-- s1: Dan (V1), ANONANG -> City Hall -> Market -> ANONANG. s2: Dee (V2), one stop.
insert into ids values ('s1', pg_temp.publish('V1', 'r1', jsonb_build_array(
  jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
    'stops', jsonb_build_array(pg_temp.id('r1_d1'))),
  jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '10:00', 'plannedTimeIn', '11:00',
    'stops', jsonb_build_array(pg_temp.id('r1_d2'))),
  jsonb_build_object('isFinal', true, 'plannedTimeOut', '12:00', 'plannedTimeIn', '13:00'))));
insert into ids values ('s2', pg_temp.publish('V2', 'r2', jsonb_build_array(
  jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
    'stops', jsonb_build_array(pg_temp.id('r2_d1'))),
  jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30'))));

-- Distance between two points --------------------------------------------------
select ok(distance_m(16.112769, 120.436222, 16.103769, 120.436222) between 990 and 1010, 'About 0.009 degrees apart is about 1 km');
select is(distance_m(16.1, 120.4, null, null), null, 'No destination position, no distance');

-- Who may tap ------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE') $$, '42501', null,
  'Scheduler cannot tap');
select pg_temp.act_as('00000000-0000-0000-0000-000000000010');
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE') $$, 'P0002', null,
  'Another Driver cannot tap');

-- The window and the leg ----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE') $$, '22023', 'Tap Start trip first',
  'Arrived before Start trip is refused');
select record_trip_attendance(pg_temp.id('s1'), 'START', 16.103769, 120.436222, 10);
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'WAIT') $$, '22023', null,
  'An unknown tap is refused');
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 3), 'ARRIVE') $$, '22023', null,
  'The final leg takes End trip, not Arrived');
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s2', 1), 'ARRIVE') $$, 'P0002', null,
  'A leg from another schedule is refused');
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE', 16.1, null) $$, '22023', null,
  'Half a position is refused');

-- Arrived and Leaving ----------------------------------------------------------
select lives_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE', 16.112769, 120.436222, 15, ' City Hall ') $$,
  'The Driver arrives at City Hall');
select is((select distance_m from stop_taps where leg_id = pg_temp.leg('s1', 1) and kind = 'ARRIVE'), 0::double precision,
  'At the destination''s saved position is 0 m');
select is((select address from stop_taps where leg_id = pg_temp.leg('s1', 1) and kind = 'ARRIVE'), 'City Hall',
  'The address is kept, trimmed');
select is((select revision_id from stop_taps where leg_id = pg_temp.leg('s1', 1) and kind = 'ARRIVE'),
  (select published_revision_id from schedules where id = pg_temp.id('s1')), 'It pins the approved version');
select is((select lat from record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE', 10, 10)), 16.112769::double precision,
  'Repeating Arrived keeps the first tap');
select lives_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'LEAVE', 16.103769, 120.436222) $$,
  'The Driver leaves City Hall, from somewhere else');
select ok((select distance_m between 990 and 1010 from stop_taps where leg_id = pg_temp.leg('s1', 1) and kind = 'LEAVE'),
  'Leaving 1 km from City Hall is recorded with its distance');
select lives_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'ARRIVE', 16.2, 120.5) $$,
  'The Driver arrives at the Market');
select is((select distance_m from stop_taps where leg_id = pg_temp.leg('s1', 2) and kind = 'ARRIVE'), null,
  'A destination with no saved position gives no distance');

select record_trip_attendance(pg_temp.id('s1'), 'END', 16.103769, 120.436222);
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'LEAVE') $$, '22023', 'This trip has ended',
  'No stop taps after End trip');

-- Admin acting as Driver ---------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select record_trip_attendance(pg_temp.id('s2'), 'START');
select lives_ok($$ select record_stop_tap(pg_temp.id('s2'), pg_temp.leg('s2', 1), 'ARRIVE') $$, 'Admin taps Arrived for a Driver');
select is((select driver_id from stop_taps where leg_id = pg_temp.leg('s2', 1)),
  '00000000-0000-0000-0000-000000000010'::uuid, 'The tap still belongs to the assigned Driver');
select ok(
  (select is_admin_override from audit_events
   where action = 'stop.arrive' and record_id = (select id from stop_taps where leg_id = pg_temp.leg('s2', 1))),
  'The Admin tap is audited with is_admin_override');

-- Who can read -----------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select is((select count(*)::int from stop_taps), 3, 'A Driver sees only their own taps');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from stop_taps), 0, 'A Scheduler sees no taps');

select * from finish();
rollback;

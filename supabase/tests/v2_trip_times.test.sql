-- Stop times: trip_times_missing, set_trip_time (an Admin fills in or
-- corrects a TIME OUT / TIME IN) and mark_completion_done refusing a trip
-- with a time missing.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-000000000010', 'driver2@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-000000000010', 'driver2', 'Dee Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e'),
  ('V2', 'Van 2', '00000000-0000-0000-0000-000000000010');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd1', 'City Hall', 'Active'),
  ('destinations', 'd2', 'Market', 'Active'),
  ('purposes', 'p1', 'Inspection', 'Active');

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
create function pg_temp.leg(p_schedule text, p_no int) returns uuid language sql as $$
  select l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id(p_schedule) and l.leg_no = p_no;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into ids select 'r1', id from create_request(pg_temp.manila_today() - 1, 'REGULAR', null, null,
  '[{"destinationId":"d1","purposeId":"p1"},{"destinationId":"d2","purposeId":"p1"}]');
insert into ids select 'r2', id from create_request(pg_temp.manila_today() - 1, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]');
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
-- s1: Dan, ANONANG -> City Hall -> Market -> ANONANG (3 legs, 6 times).
insert into ids values ('s1', pg_temp.publish('V1', 'r1', jsonb_build_array(
  jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
    'stops', jsonb_build_array(pg_temp.id('r1_d1'))),
  jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '10:00', 'plannedTimeIn', '11:00',
    'stops', jsonb_build_array(pg_temp.id('r1_d2'))),
  jsonb_build_object('isFinal', true, 'plannedTimeOut', '12:00', 'plannedTimeIn', '13:00'))));
-- s2: Dee, one stop, used for a leg from another trip.
insert into ids values ('s2', pg_temp.publish('V2', 'r2', jsonb_build_array(
  jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
    'stops', jsonb_build_array(pg_temp.id('r2_d1'))),
  jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30'))));

-- Missing times -------------------------------------------------------------------
select is(trip_times_missing(pg_temp.id('s1')), 6, 'An untapped three-leg trip is missing all six times');

-- Dan starts, arrives at City Hall, forgets Leaving it, then does the Market and ends.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select record_trip_attendance(pg_temp.id('s1'), 'START');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'ARRIVE');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'LEAVE');
select record_trip_attendance(pg_temp.id('s1'), 'END');
select is(trip_times_missing(pg_temp.id('s1')), 1, 'Only Leg 2 Time Out (Leaving City Hall) is missing');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OUT', '09:40') $$, '22023',
  'Times can be filled in once the Driver submits the trip', 'No filling in before the Driver submits');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select submit_completion(pg_temp.id('s1'), 100, 130);

-- Who may fill in ----------------------------------------------------------------
select throws_ok($$ select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OUT', '09:40') $$, '42501', null,
  'A Driver cannot fill in times');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OUT', '09:40') $$, '42501', null,
  'A Scheduler cannot fill in times');

-- Done waits for every time --------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select mark_completion_done(pg_temp.id('s1')) $$, '22023',
  'Fill in every Time Out and Time In before marking this trip done (1 missing)', 'Done is refused with a time missing');
select throws_ok($$ select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'LATER', '09:40') $$, '22023', null,
  'An unknown field is refused');
select throws_ok($$ select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s2', 1), 'OUT', '09:40') $$, 'P0002', null,
  'A leg from another trip is refused');

select lives_ok($$ select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OUT', '09:40:30') $$, 'Admin fills in the missing time');
select is((select time from trip_time_corrections where leg_id = pg_temp.leg('s1', 2) and field = 'OUT'), '09:40'::time,
  'It is kept to the minute');
select is(trip_times_missing(pg_temp.id('s1')), 0, 'Nothing is missing now');
select lives_ok($$ select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'IN', '08:55') $$, 'Admin corrects a tapped time');
select is((select count(*)::int from stop_taps where leg_id = pg_temp.leg('s1', 1) and kind = 'ARRIVE'), 1,
  'The tap it corrects is kept');
select lives_ok($$ select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OUT', '09:45') $$, 'Setting it again replaces it');
select is((select count(*)::int from trip_time_corrections where leg_id = pg_temp.leg('s1', 2)), 1, 'Still one correction for that time');
select ok(
  (select count(*) = 3 from audit_events where action = 'time.correct'
   and (after ->> 'schedule_id')::uuid = pg_temp.id('s1')),
  'Each fill-in and correction is in audit history');

-- Clearing, then Done -------------------------------------------------------------
select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OUT', null);
select is(trip_times_missing(pg_temp.id('s1')), 1, 'Clearing a fill-in makes it missing again');
select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OUT', '09:45');
select lives_ok($$ select mark_completion_done(pg_temp.id('s1')) $$, 'Done once every time is there');
select throws_ok($$ select set_trip_time(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OUT', '10:00') $$, '22023', null,
  'A done trip''s times are locked');

-- Who can read -----------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-000000000010');
select is((select count(*)::int from trip_time_corrections), 0, 'Another Driver sees none of them');

select * from finish();
rollback;

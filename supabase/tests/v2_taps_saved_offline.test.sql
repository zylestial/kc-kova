-- Taps saved on the phone without signal (0077): the "_at" twins put the
-- phone's time on the row, kept between the step before and now, record
-- when the server got it, check who may tap as before, and leave the
-- plain RPCs on the server's time.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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

-- Who may call them ---------------------------------------------------------
select ok(not has_function_privilege('anon',
  'record_stop_tap_at(timestamptz, uuid, uuid, text, double precision, double precision, double precision, text)', 'execute'),
  'Signed-out callers can''t send a saved tap');
select ok(has_function_privilege('authenticated',
  'record_trip_attendance_at(timestamptz, uuid, text, double precision, double precision, double precision, text)', 'execute'),
  'Signed-in callers can');
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a4');
select throws_ok($$ select record_trip_attendance_at(now() - interval '3 hours', pg_temp.id('s1'), 'START') $$, 'P0002', null,
  'Another Driver can''t start the trip with a saved tap either');
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a3');
select throws_ok($$ select record_trip_attendance_at(null, pg_temp.id('s1'), 'START') $$, '22023', 'The tap has no time',
  'A saved tap needs its time');

-- The phone's time, within bounds -------------------------------------------
select record_trip_attendance_at(now() - interval '3 hours', pg_temp.id('s1'), 'START');
reset role;
select is((select start_at from trip_attendance where schedule_id = pg_temp.id('s1')), now() - interval '3 hours',
  'Start trip takes the time it was tapped');
select is((select start_sent_at from trip_attendance where schedule_id = pg_temp.id('s1')), now(),
  'and notes when the server got it');

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a3');
select record_stop_tap_at(now() - interval '4 hours', pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE');
reset role;
select is((select at from stop_taps where leg_id = pg_temp.leg('s1', 1) and kind = 'ARRIVE'), now() - interval '3 hours',
  'A stop tap timed before Start trip reads as Start trip');
select is((select sent_at from stop_taps where leg_id = pg_temp.leg('s1', 1) and kind = 'ARRIVE'), now(),
  'and notes when the server got it');

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a3');
select record_stop_tap_at(now() - interval '2 hours', pg_temp.id('s1'), pg_temp.leg('s1', 1), 'LEAVE');
select record_stop_tap_at(now() - interval '1 hour', pg_temp.id('s1'), pg_temp.leg('s1', 1), 'LEAVE');
reset role;
select is((select at from stop_taps where leg_id = pg_temp.leg('s1', 1) and kind = 'LEAVE'), now() - interval '2 hours',
  'Leaving takes its tapped time, and a repeat keeps the first');

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a3');
select record_trip_attendance_at(now() + interval '1 hour', pg_temp.id('s1'), 'END');
reset role;
select is((select end_at from trip_attendance where schedule_id = pg_temp.id('s1')), now(),
  'A time ahead of the server''s reads as now');
select is((select end_sent_at from trip_attendance where schedule_id = pg_temp.id('s1')), now(),
  'End trip notes when the server got it');

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a4');
select record_trip_attendance_at(now() - interval '3 days', pg_temp.id('s2'), 'START');
reset role;
select is((select start_at from trip_attendance where schedule_id = pg_temp.id('s2')),
  pg_temp.yesterday()::timestamp at time zone 'Asia/Manila',
  'Start trip timed before the trip''s day reads as that day''s midnight');

-- Plain taps keep the server's time -----------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a4');
select record_stop_tap(pg_temp.id('s2'), pg_temp.leg('s2', 1), 'ARRIVE');
reset role;
select is((select at from stop_taps where leg_id = pg_temp.leg('s2', 1) and kind = 'ARRIVE'), now(),
  'A plain tap after a saved one in the same transaction takes the server''s time');
select is((select sent_at from stop_taps where leg_id = pg_temp.leg('s2', 1) and kind = 'ARRIVE'), null,
  'and has no sent time');

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

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a6');
select throws_ok($$ select start_company_trip_at(now() - interval '5 hours', pg_temp.id('trip'), 48215) $$, 'P0002', 'Trip not found',
  'The Driver can''t record a Company trip with a saved tap');
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a5');
select start_company_trip_at(now() - interval '5 hours', pg_temp.id('trip'), 48215);
select record_company_stop_at(now() - interval '6 hours', pg_temp.id('trip'), pg_temp.leg('trip', 1), 'ARRIVE');
select record_company_stop_at(now() - interval '4 hours', pg_temp.id('trip'), pg_temp.leg('trip', 1), 'LEAVE');
select end_company_trip_at(now() - interval '5 hours', pg_temp.id('trip'), 48262);
reset role;
select is((select start_at from company_trip_runs where schedule_id = pg_temp.id('trip')), now() - interval '5 hours',
  'Company Start trip takes the time it was tapped');
select is((select start_sent_at from company_trip_runs where schedule_id = pg_temp.id('trip')), now(),
  'and notes when the server got it');
select is((select at from stop_taps where leg_id = pg_temp.leg('trip', 1) and kind = 'ARRIVE'), now() - interval '5 hours',
  'A Company stop timed before Start trip reads as Start trip');
select is((select at from stop_taps where leg_id = pg_temp.leg('trip', 1) and kind = 'LEAVE'), now() - interval '4 hours',
  'Company Leaving takes its tapped time');
select is((select end_at from company_trip_runs where schedule_id = pg_temp.id('trip')), now() - interval '4 hours',
  'Company End trip timed before the last stop tap reads as that tap');
select is((select end_sent_at from company_trip_runs where schedule_id = pg_temp.id('trip')), now(),
  'and notes when the server got it');

select * from finish();
rollback;

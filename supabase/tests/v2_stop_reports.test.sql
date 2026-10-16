-- Stop reports (0061): report_stop at a stop of a trip on the road, who may
-- report, who is told, missing times, and a Company trip passing a missed
-- stop. Since 0068 every report holds the trip until a Scheduler or Admin
-- answers: Skip it, Wait there, End the trip or Change the route.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-0000000001a1', 'rhea3@test.local'),
  ('00000000-0000-0000-0000-0000000001a5', 'jun3@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver');
insert into accounts (id, username, name, role, position, can_request_company) values
  ('00000000-0000-0000-0000-0000000001a1', 'rhea3', 'Rhea Santos', 'Requester', 'Purchasing Officer', true);
insert into accounts (id, username, name, role, driver_type) values
  ('00000000-0000-0000-0000-0000000001a5', 'jun3', 'Jun Reyes', 'Driver', 'Company car');
insert into vehicles (plate, name, assigned_driver_id) values ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e');
insert into vehicles (plate, name, company_trips) values ('TM', 'Mirage', true);
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd1', 'City Hall', 'Active'),
  ('destinations', 'd2', 'Market', 'Active'),
  ('purposes', 'p1', 'Inspection', 'Active'),
  ('projects', 'tp', 'Head office', 'Active'),
  ('starting_points', 'tsp', 'Main Office', 'Active'),
  ('supervisors', 'tsup', 'Engr. Dante Villanueva', 'Active'),
  ('heads', 'th', 'Engr. Carmela Ong', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.leg(p_trip text, p_no int) returns uuid language sql as $$
  select l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id(p_trip) and l.leg_no = p_no;
$$;
create function pg_temp.rv(p_schedule uuid) returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = p_schedule and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;

-- s1: Dan (V1), today: ANONANG -> City Hall -> Market -> ANONANG.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into ids select 'r1', id from create_request(pg_temp.today(), 'URGENT', null, null,
  '[{"destinationId":"d1","purposeId":"p1"},{"destinationId":"d2","purposeId":"p1"}]', null);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 's1', schedule_id from save_schedule_draft(null, null, pg_temp.today(), 'V1',
  array[pg_temp.id('r1')], (select jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00', 'stops', jsonb_build_array(
      (select id from request_destinations where request_id = pg_temp.id('r1') and position = 1))),
    jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '10:00', 'plannedTimeIn', '11:00', 'stops', jsonb_build_array(
      (select id from request_destinations where request_id = pg_temp.id('r1') and position = 2))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '12:00', 'plannedTimeIn', '13:00'))));
select submit_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));

-- Before Start trip, and who may report -------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'NOT_AVAILABLE', 'Gate locked') $$,
  '22023', 'Tap Start trip first', 'No reports before Start trip');
select record_trip_attendance(pg_temp.id('s1'), 'START');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'NOT_AVAILABLE', 'Gate locked') $$,
  'P0002', null, 'A Scheduler doesn''t report stops');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 3), 'ROAD_BLOCKED') $$,
  '22023', null, 'Not on the way back to ANONANG');
select throws_ok($$ select report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'LOST') $$,
  '22023', 'Choose what happened', 'An unknown kind is refused');

-- Not available: the trip waits for the Scheduler (0068) ----------------------------------
select lives_ok($$ select report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'NOT_AVAILABLE', 'Nobody at the gate', false, 16.1, 120.4, 12) $$,
  'The Driver reports City Hall not available');
select ok(not (select missed from problem_reports where leg_id = pg_temp.leg('s1', 1)), 'It isn''t missed until the Scheduler answers');
select ok((select paused_at is not null from schedules where id = pg_temp.id('s1')), 'The trip is on hold');
select is((select reported_by_account_id from problem_reports where leg_id = pg_temp.leg('s1', 1)),
  '00000000-0000-0000-0000-00000000000e'::uuid, 'The Driver reported it');
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE') $$,
  '22023', 'Wait for the Scheduler''s answer first', 'No taps while it waits');
reset role;
select is((select count(*)::int from notifications where type = 'STOP_REPORTED' and account_id = '00000000-0000-0000-0000-00000000000d'), 1,
  'The Scheduler is told');
select is((select count(*)::int from notifications where type = 'STOP_REPORTED' and account_id = '00000000-0000-0000-0000-00000000000a'), 1,
  'Admins are told');
select ok((select message from notifications where type = 'STOP_REPORTED' and account_id = '00000000-0000-0000-0000-00000000000d')
  like 'Not available at City Hall: V1% Waiting for your answer', 'It says what and where, and that it waits');

-- Skip it: the stop is missed and the Driver goes on -----------------------------------------
insert into ids select 'na', id from problem_reports where leg_id = pg_temp.leg('s1', 1);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select answer_stop_report(pg_temp.id('na'), 'SKIP') $$, '42501', null, 'The Driver doesn''t answer');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select answer_stop_report(pg_temp.id('na'), 'MAYBE') $$, '22023', 'Choose an answer', 'An unknown answer is refused');
select lives_ok($$ select answer_stop_report(pg_temp.id('na'), 'SKIP') $$, 'The Scheduler says skip it');
select throws_ok($$ select answer_stop_report(pg_temp.id('na'), 'WAIT') $$, '22023', 'This report was already answered. Reload and try again',
  'Answered once');
reset role;
select ok((select missed from problem_reports where id = pg_temp.id('na')), 'City Hall is missed');
select ok((select paused_at is null from schedules where id = pg_temp.id('s1')), 'The trip goes on');
select ok((select message from notifications where type = 'STOP_ANSWERED' and account_id = '00000000-0000-0000-0000-00000000000e')
  like 'Not available at City Hall: Skip City Hall and go on to the next stop', 'The Driver is told the answer');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'WRONG_ADDRESS', 'Closed') $$,
  '22023', 'This stop was already reported missed', 'A stop is missed once');

-- Wait there: the stop is kept ------------------------------------------------------------------
insert into ids select 'rb', id from report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'ROAD_BLOCKED', 'Flooded');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select answer_stop_report(pg_temp.id('rb'), 'WAIT');
reset role;
select ok(not (select missed from problem_reports where id = pg_temp.id('rb')), 'Wait there keeps the Market');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select lives_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'ARRIVE') $$, 'and the Driver taps it when there');

-- Held until every report is answered; an Admin answers too ------------------------------------
insert into ids select 'vp', id from report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'VEHICLE_PROBLEM', 'Flat tire');
select lives_ok($$ select report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OTHER', '  ') $$, 'A note is optional');
insert into ids select 'other', id from problem_reports where leg_id = pg_temp.leg('s1', 2) and kind = 'OTHER';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select answer_stop_report(pg_temp.id('vp'), 'WAIT');
reset role;
select ok((select paused_at is not null from schedules where id = pg_temp.id('s1')), 'Still on hold while another report waits');
select ok((select message from notifications where type = 'STOP_ANSWERED' and related_schedule_id = pg_temp.id('s1')
  and message like 'Vehicle problem%') like '%Go on once the vehicle is fixed', 'Wait there, for a vehicle problem');

-- Change the route: held until the Admin approves it -------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select answer_stop_report(pg_temp.id('other'), 'CHANGE') $$, 'An Admin answers: change the route');
reset role;
select ok((select paused_at is not null from schedules where id = pg_temp.id('s1')), 'Still on hold until the change is approved');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select save_schedule_draft(pg_temp.id('s1'), null, null, 'V1', array[pg_temp.id('r1')], (select jsonb_agg(jsonb_build_object(
    'id', l.id, 'destinationId', l.destination_id, 'isFinal', l.is_final,
    'plannedTimeOut', to_char(l.planned_time_out, 'HH24:MI'),
    'plannedTimeIn', case when l.is_final then '13:30' else to_char(l.planned_time_in, 'HH24:MI') end,
    'stops', coalesce((select jsonb_agg(ls.request_destination_id) from leg_stops ls where ls.leg_id = l.id and ls.revision_id = l.revision_id), '[]'::jsonb))
    order by l.leg_no)
  from schedule_legs l join schedules s on s.published_revision_id = l.revision_id where s.id = pg_temp.id('s1')));
select submit_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$, 'The Admin approves the change');
reset role;
select ok((select paused_at is null from schedules where id = pg_temp.id('s1')), 'and the trip goes on');
select is((select status || ': ' || handling_note from problem_reports where id = pg_temp.id('other')), 'HANDLED: Route changed',
  'The report is done');

-- End trip closes a report still waiting -------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
insert into ids select 'late', id from report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OTHER', 'Running late');
select lives_ok($$ select record_trip_attendance(pg_temp.id('s1'), 'END') $$, 'End trip works while on hold');
reset role;
select is((select status || ': ' || handling_note from problem_reports where id = pg_temp.id('late')), 'HANDLED: The trip ended',
  'and closes the report still waiting');
select ok((select paused_at is null from schedules where id = pg_temp.id('s1')), 'The hold ends with the trip');
select is(trip_times_missing(pg_temp.id('s1')), 1, 'Only Leaving the Market is missing, not City Hall''s times');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'OTHER', 'Late') $$,
  '22023', 'This trip has ended', 'No reports after End trip');

-- A Company trip passes a missed stop -------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
insert into ids select 'g', (create_request_group('COMPANY', jsonb_build_object(
  'date', pg_temp.today(), 'startingPointId', 'tsp', 'vehiclePlate', 'TM',
  'driverId', '00000000-0000-0000-0000-0000000001a5', 'supervisorId', 'tsup', 'headId', 'th',
  'stops', jsonb_build_array(
    jsonb_build_object('projectId', 'tp', 'destinationId', 'd1', 'purposeId', 'p1'),
    jsonb_build_object('projectId', 'tp', 'destinationId', 'd2', 'purposeId', 'p1'))))).id;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 'trip', (create_company_trip(pg_temp.today(), 'TM',
  array(select id from requests where group_id = pg_temp.id('g') order by stop_letter),
  (select jsonb_agg(jsonb_build_object('destinationId', rd.destination_id, 'plannedTimeOut', t.out, 'plannedTimeIn', t.inn,
     'stops', jsonb_build_array(rd.id)) order by r.stop_letter)
   from requests r join request_destinations rd on rd.request_id = r.id and rd.active
   join (values ('A', '14:00', '14:30'), ('B', '15:00', '15:30')) as t (letter, out, inn) on t.letter = r.stop_letter
   where r.group_id = pg_temp.id('g')))).schedule_id;
select submit_schedule(pg_temp.id('trip'), pg_temp.rv(pg_temp.id('trip')));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('trip'), pg_temp.rv(pg_temp.id('trip')));
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
select start_company_trip(pg_temp.id('trip'), 1000);
select lives_ok($$ select report_stop(pg_temp.id('trip'), pg_temp.leg('trip', 1), 'WRONG_ADDRESS', 'Office moved') $$,
  'The requester reports the first stop closed');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select answer_stop_report((select id from problem_reports where schedule_id = pg_temp.id('trip')), 'SKIP');
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
select lives_ok($$ select end_company_trip(pg_temp.id('trip'), 1012) $$, 'and ends the trip at the last stop without tapping the first');
select is((select count(*)::int from problem_reports where schedule_id = pg_temp.id('trip')), 1, 'The requester sees their report');

select * from finish();
rollback;

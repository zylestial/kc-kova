-- Stops not reached (0066): End trip reports every non-final leg after the
-- last one reached as missed (NOT_REACHED), a fuel stop already handled; a
-- leg before one reached (a forgotten tap) is not. The requester is told
-- when their stop is missed, by report_stop and by End trip. Since 0067 a
-- report can name some of the requests at a stop: the stop is still reached,
-- and the Scheduler plans just those again.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'req1@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-0000000000b1', 'req1', 'Rita Requester', 'Requester');
insert into vehicles (plate, name, assigned_driver_id) values ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e');
insert into booking_options ("group", id, name, status, is_other_stop) values
  ('destinations', 'd1', 'City Hall', 'Active', false),
  ('destinations', 'd2', 'Market', 'Active', false),
  ('destinations', 'd3', 'Plaza', 'Active', false),
  ('destinations', 'f1', 'Shell', 'Active', true),
  ('purposes', 'p1', 'Inspection', 'Active', false);

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
create function pg_temp.leg(p_no int) returns uuid language sql as $$
  select l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id('s1') and l.leg_no = p_no;
$$;
create function pg_temp.rv() returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = pg_temp.id('s1') and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
create function pg_temp.stops_of(p_k text) returns jsonb language sql as $$
  select jsonb_agg(id) from request_destinations where request_id = pg_temp.id(p_k);
$$;
create function pg_temp.missed_notes() returns int language sql as $$
  select count(*)::int from notifications where type = 'STOP_MISSED' and account_id = '00000000-0000-0000-0000-0000000000b1';
$$;

-- City Hall, Market and Plaza, one stop each, by req1.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'r1', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
insert into ids select 'r2', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d2","purposeId":"p1"}]', null);
insert into ids select 'r3', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d3","purposeId":"p1"}]', null);
reset role;

-- s1: ANONANG -> City Hall -> Market -> Shell (fuel) -> Plaza -> ANONANG.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 's1', schedule_id from save_schedule_draft(null, null, pg_temp.today(), 'V1',
  array[pg_temp.id('r1'), pg_temp.id('r2'), pg_temp.id('r3')], jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00', 'stops', pg_temp.stops_of('r1')),
    jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:00', 'stops', pg_temp.stops_of('r2')),
    jsonb_build_object('destinationId', 'f1', 'plannedTimeOut', '10:30', 'plannedTimeIn', '11:00', 'stops', '[]'::jsonb),
    jsonb_build_object('destinationId', 'd3', 'plannedTimeOut', '11:30', 'plannedTimeIn', '12:00', 'stops', pg_temp.stops_of('r3')),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '12:30', 'plannedTimeIn', '13:00')));
select submit_schedule(pg_temp.id('s1'), pg_temp.rv());
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('s1'), pg_temp.rv());

-- The Driver forgets City Hall's taps, reaches the Market, and nobody is there.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select record_trip_attendance(pg_temp.id('s1'), 'START');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg(2), 'ARRIVE');
select report_stop(pg_temp.id('s1'), pg_temp.leg(2), 'NOT_AVAILABLE', '');
reset role;
select is(pg_temp.missed_notes(), 1, 'The requester is told their stop was missed');
select ok((select message from notifications where type = 'STOP_MISSED') like 'Your stop at Market was missed (Not available)%',
  'saying where and why');

-- Then ends the trip early.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select lives_ok($$ select record_trip_attendance(pg_temp.id('s1'), 'END') $$, 'End trip with stops left');
reset role;
select is((select count(*)::int from problem_reports where kind = 'NOT_REACHED'), 2, 'The two stops after the Market are not reached');
select ok(not exists (select 1 from problem_reports where leg_id = pg_temp.leg(1)), 'City Hall, before a stop reached, is not');
select is((select status || ' ' || missed from problem_reports where leg_id = pg_temp.leg(4)), 'OPEN true',
  'Plaza is missed, for the Scheduler to plan again');
select is((select status || ': ' || handling_note from problem_reports where leg_id = pg_temp.leg(3)), 'HANDLED: Nothing to plan again',
  'The fuel stop is handled already');
select is(pg_temp.missed_notes(), 2, 'Plaza''s requester is told');
select is((select count(*)::int from notifications where type = 'STOP_REPORTED' and account_id = '00000000-0000-0000-0000-00000000000d'
  and message like 'Trip ended before Shell, Plaza: V1''s trip on %'), 1, 'The Scheduler is told once, naming both');
select is(trip_times_missing(pg_temp.id('s1')), 2, 'Only City Hall''s forgotten taps are missing: no made-up times for stops not reached');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok($$ select release_missed_stop((select id from problem_reports where leg_id = pg_temp.leg(4))) $$,
  'The Scheduler plans Plaza again');
reset role;
select ok((select missed_at is not null from requests where id = pg_temp.id('r3')), 'and it can go on any day');

-- Some of the stops at a place (0067) ----------------------------------------------------
-- s2: Dee (V2) today, two requests at City Hall on one leg; one of them isn't ready.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'r4', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
insert into ids select 'r5', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000f', 'driver2@test.local');
insert into accounts (id, username, name, role) values ('00000000-0000-0000-0000-00000000000f', 'driver2', 'Dee Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values ('V2', 'Van 2', '00000000-0000-0000-0000-00000000000f');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 's2', schedule_id from save_schedule_draft(null, null, pg_temp.today(), 'V2',
  array[pg_temp.id('r4'), pg_temp.id('r5')], jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '14:00', 'plannedTimeIn', '14:30',
      'stops', pg_temp.stops_of('r4') || pg_temp.stops_of('r5')),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '15:00', 'plannedTimeIn', '15:30')));
select submit_schedule(pg_temp.id('s2'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('s2') and status = 'DRAFT'));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('s2'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('s2') and status = 'SUBMITTED'));
reset role;
insert into ids select 's2leg', l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id('s2') and l.leg_no = 1;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select record_trip_attendance(pg_temp.id('s2'), 'START');
select throws_ok($$ select report_stop(pg_temp.id('s2'), pg_temp.id('s2leg'), 'VEHICLE_PROBLEM', '', false, null, null, null, array[pg_temp.id('r4')]) $$,
  '22023', 'Only Not available or Wrong address can be for some of the stops here', 'Only a missed kind can be for some stops');
select throws_ok($$ select report_stop(pg_temp.id('s2'), pg_temp.id('s2leg'), 'NOT_AVAILABLE', '', false, null, null, null, array[pg_temp.id('r1')]) $$,
  '22023', 'Choose stops at this place', 'Only requests at this stop');
insert into ids select 'some', id from report_stop(pg_temp.id('s2'), pg_temp.id('s2leg'), 'NOT_AVAILABLE', '', false, null, null, null, array[pg_temp.id('r4')]);
reset role;
select is((select missed::text || ' ' || (request_ids = array[pg_temp.id('r4')])::text from problem_reports where id = pg_temp.id('some')), 'false true',
  'A report for one of the two: the stop is still reached');
select is((select count(*)::int from notifications where type = 'STOP_MISSED' and related_request_id in (pg_temp.id('r4'), pg_temp.id('r5'))), 1,
  'Only that stop''s requester is told');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select lives_ok($$ select record_stop_tap(pg_temp.id('s2'), pg_temp.id('s2leg'), 'ARRIVE') $$, 'The Driver still taps Arrived there');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok($$ select release_missed_stop(pg_temp.id('some')) $$, 'The Scheduler plans that one again');
reset role;
select is((select array_agg(r.id order by r.id) from schedule_requests sr join requests r on r.id = sr.request_id
  where sr.schedule_id = pg_temp.id('s2') and sr.active), array[pg_temp.id('r5')], 'and the other stays on the trip');

select * from finish();
rollback;

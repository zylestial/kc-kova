-- Come back later (0086): the Scheduler sends the Driver on, and the requests
-- move to a new stop at the same place, after the stop picked, with no Admin
-- and no "missed" message.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- These test other rules, so taps here read as made before tasks at a stop (0088);
-- v2_stop_tasks.test.sql tests that rule.
alter table stop_taps alter column before_tasks set default true;
alter table company_trip_runs alter column before_tasks set default true;

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-00000000000f', 'driver2@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'req1@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-00000000000f', 'driver2', 'Dee Driver', 'Driver'),
  ('00000000-0000-0000-0000-0000000000b1', 'req1', 'Rita Requester', 'Requester');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e'),
  ('V2', 'Van 2', '00000000-0000-0000-0000-00000000000f');
insert into booking_options ("group", id, name, status, is_other_stop) values
  ('destinations', 'd1', 'Wilcon', 'Active', false),
  ('destinations', 'd2', 'Site A', 'Active', false),
  ('destinations', 'd3', 'Site B', 'Active', false),
  ('purposes', 'p1', 'Pick up', 'Active', false);

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
create function pg_temp.leg(p_schedule text, p_no int) returns uuid language sql as $$
  select l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id(p_schedule) and l.leg_no = p_no;
$$;
create function pg_temp.stops_of(p_k text) returns jsonb language sql as $$
  select jsonb_agg(id) from request_destinations where request_id = pg_temp.id(p_k);
$$;
create function pg_temp.route(p_schedule text) returns text language sql as $$
  select string_agg(l.origin || '>' || l.destination_name, ', ' order by l.leg_no)
  from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id(p_schedule);
$$;
create function pg_temp.times(p_schedule text) returns text language sql as $$
  select string_agg(to_char(l.planned_time_out, 'HH24:MI') || '-' || to_char(l.planned_time_in, 'HH24:MI'), ', ' order by l.leg_no)
  from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id(p_schedule);
$$;
create function pg_temp.leg_of(p_request text) returns smallint language sql as $$
  select l.leg_no from leg_stops ls
  join schedule_legs l on l.id = ls.leg_id
  join schedules s on s.published_revision_id = ls.revision_id
  join request_destinations rd on rd.id = ls.request_destination_id
  where rd.request_id = pg_temp.id(p_request) and s.status = 'ACTIVE';
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'r1', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
insert into ids select 'r2', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
insert into ids select 'r3', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d2","purposeId":"p1"}]', null);
insert into ids select 'r4', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
insert into ids select 'r5', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d2","purposeId":"p1"}]', null);
insert into ids select 'r6', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d3","purposeId":"p1"}]', null);
reset role;

-- s1: Wilcon (two requests) -> Site A -> ANONANG.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 's1', schedule_id from save_schedule_draft(null, null, pg_temp.today(), 'V1',
  array[pg_temp.id('r1'), pg_temp.id('r2'), pg_temp.id('r3')], jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00', 'stops', pg_temp.stops_of('r1') || pg_temp.stops_of('r2')),
    jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:00', 'stops', pg_temp.stops_of('r3')),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '10:15', 'plannedTimeIn', '11:00')));
select submit_schedule(pg_temp.id('s1'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('s1') and status = 'DRAFT'));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('s1'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('s1') and status = 'SUBMITTED'));

-- One of the two isn't paid yet ----------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select record_trip_attendance(pg_temp.id('s1'), 'START');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE');
insert into ids select 'some', id from report_stop(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'NOT_READY', 'Not paid yet', false, null, null, null, array[pg_temp.id('r1')]);
reset role;
select ok((select paused_at is not null from schedules where id = pg_temp.id('s1')), 'Not ready holds the trip until the answer');
select is((select request_ids = array[pg_temp.id('r1')] from problem_reports where id = pg_temp.id('some')), true, 'and can name one of the two');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select come_back_later(pg_temp.id('some'), pg_temp.leg('s1', 2)) $$,
  '42501', 'Only a Scheduler or Admin answers a stop report', 'A Driver can''t answer it');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select come_back_later(pg_temp.id('some'), pg_temp.leg('s1', 1)) $$,
  '22023', 'Choose a stop still ahead on this trip', 'It has to be after a stop still ahead');
select throws_ok($$ select come_back_later(pg_temp.id('some'), pg_temp.leg('s1', 3)) $$,
  '22023', 'Choose a stop still ahead on this trip', 'not after the way back');
select lives_ok($$ select come_back_later(pg_temp.id('some'), pg_temp.leg('s1', 2)) $$, 'The Scheduler says come back after Site A');
reset role;

select is(pg_temp.route('s1'), 'ANONANG>Wilcon, Wilcon>Site A, Site A>Wilcon, Wilcon>ANONANG', 'The route goes back to Wilcon');
select is(pg_temp.times('s1'), '08:00-09:00, 09:30-10:00, 10:00-10:30, 10:30-11:15', 'A planned half hour, and the way back moves only as far as it must');
select is(pg_temp.leg_of('r1'), 3::smallint, 'The request not ready moves to the new stop');
select is(pg_temp.leg_of('r2'), 1::smallint, 'The other stays at the first');
select is((select missed::text || ' ' || status || ' ' || decision from problem_reports where id = pg_temp.id('some')), 'false HANDLED LATER', 'The stop isn''t missed');
select ok((select paused_at is null from schedules where id = pg_temp.id('s1')), 'The hold ends');
select is((select count(*)::int from notifications where type = 'STOP_MISSED'), 0, 'Nobody is told it was missed');
select is((select message from notifications where type = 'STOP_ANSWERED' and account_id = '00000000-0000-0000-0000-00000000000e'),
  'Not ready yet at Wilcon: Do the others at Wilcon, then go on. Come back after Site A for the rest', 'The Driver is told what to do');
select is((select upper(period) from schedule_reservations where schedule_id = pg_temp.id('s1')),
  (pg_temp.today() + time '11:15') at time zone 'Asia/Manila', 'The trip''s reserved time grows with it');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select lives_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'LEAVE') $$, 'The Driver leaves Wilcon');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'ARRIVE');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 2), 'LEAVE');
select lives_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 3), 'ARRIVE') $$, 'and taps Arrived at Wilcon again');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 3), 'LEAVE');
select record_trip_attendance(pg_temp.id('s1'), 'END');
reset role;
select is(trip_times_missing(pg_temp.id('s1')), 0, 'Every time on the form comes from a tap');
select is((select count(*)::int from problem_reports where schedule_id = pg_temp.id('s1') and kind = 'NOT_REACHED'), 0, 'Nothing is left not reached');

-- The only request there, and the trip ends before the Driver gets back ------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 's2', schedule_id from save_schedule_draft(null, null, pg_temp.today(), 'V2',
  array[pg_temp.id('r4'), pg_temp.id('r5'), pg_temp.id('r6')], jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '12:00', 'plannedTimeIn', '12:30', 'stops', pg_temp.stops_of('r4')),
    jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '13:00', 'plannedTimeIn', '13:30', 'stops', pg_temp.stops_of('r5')),
    jsonb_build_object('destinationId', 'd3', 'plannedTimeOut', '14:00', 'plannedTimeIn', '14:30', 'stops', pg_temp.stops_of('r6')),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '15:00', 'plannedTimeIn', '15:30')));
select submit_schedule(pg_temp.id('s2'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('s2') and status = 'DRAFT'));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('s2'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('s2') and status = 'SUBMITTED'));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select record_trip_attendance(pg_temp.id('s2'), 'START');
select record_stop_tap(pg_temp.id('s2'), pg_temp.leg('s2', 1), 'ARRIVE');
insert into ids select 'whole', id from report_stop(pg_temp.id('s2'), pg_temp.leg('s2', 1), 'NOT_READY', '');

-- Route changes waiting would lose the new stop.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select answer_stop_report(pg_temp.id('whole'), 'CHANGE');
select save_schedule_draft(pg_temp.id('s2'), null, null, 'V2',
  array[pg_temp.id('r4'), pg_temp.id('r5'), pg_temp.id('r6')], (select jsonb_agg(jsonb_build_object(
    'id', l.id, 'destinationId', l.destination_id, 'isFinal', l.is_final,
    'plannedTimeOut', to_char(l.planned_time_out, 'HH24:MI'), 'plannedTimeIn', to_char(l.planned_time_in, 'HH24:MI'),
    'stops', coalesce((select jsonb_agg(ls.request_destination_id) from leg_stops ls where ls.leg_id = l.id and ls.revision_id = l.revision_id), '[]'::jsonb))
    order by l.leg_no)
  from schedule_legs l join schedules s on s.published_revision_id = l.revision_id where s.id = pg_temp.id('s2')));
select throws_ok($$ select come_back_later(pg_temp.id('whole'), pg_temp.leg('s2', 2)) $$,
  '22023', 'This trip has route changes waiting. Finish or discard them first', 'Not while route changes wait');
select discard_schedule_draft(pg_temp.id('s2'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('s2') and status = 'DRAFT'));

select lives_ok($$ select come_back_later(pg_temp.id('whole'), pg_temp.leg('s2', 2)) $$, 'Come back after Site A');
reset role;
select is(pg_temp.route('s2'), 'ANONANG>Wilcon, Wilcon>Site A, Site A>Wilcon, Wilcon>Site B, Site B>ANONANG', 'Wilcon is on the route twice');
select is(pg_temp.times('s2'), '12:00-12:30, 13:00-13:30, 13:30-14:00, 14:00-14:30, 15:00-15:30', 'Later stops stay put when the half hour fits');
select is((select missed::text || ' ' || status from problem_reports where id = pg_temp.id('whole')), 'true HANDLED', 'The first visit is left with no stops, and needs no Leaving');
select is(trip_times_missing(pg_temp.id('s2')), 7, 'Not its Leaving, or the next leg''s Time Out: only the stops still ahead');

-- The route can still be changed afterwards, with the empty first visit on it.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok($$ select save_schedule_draft(pg_temp.id('s2'), null, null, 'V2',
  array[pg_temp.id('r4'), pg_temp.id('r5'), pg_temp.id('r6')], (select jsonb_agg(jsonb_build_object(
    'id', l.id, 'destinationId', l.destination_id, 'isFinal', l.is_final,
    'plannedTimeOut', to_char(l.planned_time_out, 'HH24:MI'), 'plannedTimeIn', to_char(l.planned_time_in, 'HH24:MI'),
    'stops', coalesce((select jsonb_agg(ls.request_destination_id) from leg_stops ls where ls.leg_id = l.id and ls.revision_id = l.revision_id), '[]'::jsonb))
    order by l.leg_no)
  from schedule_legs l join schedules s on s.published_revision_id = l.revision_id where s.id = pg_temp.id('s2'))) $$,
  'The trip can still be changed the usual way');
select discard_schedule_draft(pg_temp.id('s2'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('s2') and status = 'DRAFT'));
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select lives_ok($$ select record_stop_tap(pg_temp.id('s2'), pg_temp.leg('s2', 2), 'ARRIVE') $$, 'The Driver goes on');
select record_stop_tap(pg_temp.id('s2'), pg_temp.leg('s2', 2), 'LEAVE');
select record_trip_attendance(pg_temp.id('s2'), 'END');
reset role;
select is((select count(*)::int from problem_reports r join schedule_legs l on l.id = r.leg_id
  where r.schedule_id = pg_temp.id('s2') and r.kind = 'NOT_REACHED' and r.status = 'OPEN' and l.destination_name = 'Wilcon'), 1,
  'If they never get back, Wilcon is not reached, and can go on another day');
select is((select count(*)::int from notifications where type = 'STOP_MISSED' and related_request_id = pg_temp.id('r4')), 1, 'and only then its requester is told');

select * from finish();
rollback;

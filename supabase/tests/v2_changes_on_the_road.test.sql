-- Changes to a trip on the road (0060): they go through draft changes and
-- Admin approval as usual, but approval writes them onto the version the
-- Driver follows, so the Driver's taps survive; legs already tapped can't
-- change; who's told.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd1', 'City Hall', 'Active'),
  ('destinations', 'd2', 'Market', 'Active'),
  ('destinations', 'd3', 'Port', 'Active'),
  ('purposes', 'p1', 'Inspection', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.day() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date - 1;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.rv(p_schedule uuid) returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = p_schedule and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
-- Leg p_no of the version the Driver follows.
create function pg_temp.leg(p_no int) returns uuid language sql as $$
  select l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id('s1') and l.leg_no = p_no;
$$;
-- Draft changes from the route the Driver follows, as Scheduling sends
-- them: each leg with the id it came from. p_middle goes between legs 1 and 2.
create function pg_temp.route(p_first_in text, p_middle jsonb) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('id', pg_temp.leg(1), 'destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', p_first_in,
      'stops', jsonb_build_array(pg_temp.id('r1_d1')))
  ) || p_middle || jsonb_build_array(
    jsonb_build_object('id', pg_temp.leg(2), 'destinationId', 'd2', 'plannedTimeOut', '11:00', 'plannedTimeIn', '12:00',
      'stops', jsonb_build_array(pg_temp.id('r1_d2'))),
    jsonb_build_object('id', pg_temp.leg(3), 'isFinal', true, 'plannedTimeOut', '12:30', 'plannedTimeIn', '13:30'));
$$;
-- sched proposes p_legs for p_requests and submits them.
create function pg_temp.propose(p_requests uuid[], p_legs jsonb) returns uuid language plpgsql as $$
declare
  v_revision schedule_revisions;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
  select * into v_revision from save_schedule_draft(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')), null, 'V1', p_requests, p_legs);
  perform submit_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
  return v_revision.id;
end;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into ids select 'r1', id from create_request(pg_temp.day(), 'REGULAR', null, null,
  '[{"destinationId":"d1","purposeId":"p1"},{"destinationId":"d2","purposeId":"p1"}]', null);
insert into ids select 'r2', id from create_request(pg_temp.day(), 'REGULAR', null, null, '[{"destinationId":"d3","purposeId":"p1"}]', null);
reset role;
insert into ids select 'r1_d1', id from request_destinations where request_id = pg_temp.id('r1') and position = 1;
insert into ids select 'r1_d2', id from request_destinations where request_id = pg_temp.id('r1') and position = 2;
insert into ids select 'r2_d3', id from request_destinations where request_id = pg_temp.id('r2') and active;

-- s1: Dan (V1), ANONANG -> City Hall -> Market -> ANONANG, approved.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 's1', schedule_id from save_schedule_draft(null, null, pg_temp.day(), 'V1',
  array[pg_temp.id('r1')], jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
      'stops', jsonb_build_array(pg_temp.id('r1_d1'))),
    jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '11:00', 'plannedTimeIn', '12:00',
      'stops', jsonb_build_array(pg_temp.id('r1_d2'))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '12:30', 'plannedTimeIn', '13:30')));
select submit_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
reset role;
insert into ids select 'rev1', published_revision_id from schedules where id = pg_temp.id('s1');

-- The Driver starts and taps the first stop ------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select record_trip_attendance(pg_temp.id('s1'), 'START');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg(1), 'ARRIVE');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg(1), 'LEAVE');
insert into ids values ('leg1', pg_temp.leg(1)), ('leg2', pg_temp.leg(2));

-- Draft changes adding the Port after City Hall -----------------------------------
insert into ids select 'draft1', pg_temp.propose(array[pg_temp.id('r1'), pg_temp.id('r2')],
  pg_temp.route('09:00', jsonb_build_array(jsonb_build_object('destinationId', 'd3', 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30',
    'stops', jsonb_build_array(pg_temp.id('r2_d3'))))));
reset role;
select is((select array_agg(source_leg_id order by leg_no) from schedule_legs where revision_id = pg_temp.id('draft1')),
  array[pg_temp.id('leg1'), null, pg_temp.id('leg2'), pg_temp.leg(3)], 'Each draft leg remembers the leg it came from');
select is((select count(*)::int from notifications where type = 'TRIP_CHANGED'), 0, 'The Driver hears nothing before the Admin approves');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$, 'The Admin approves the changes');
reset role;
select is((select published_revision_id from schedules where id = pg_temp.id('s1')), pg_temp.id('rev1'), 'The Driver''s version stays published');
select is(pg_temp.leg(1), pg_temp.id('leg1'), 'City Hall keeps its leg');
select is(pg_temp.leg(3), pg_temp.id('leg2'), 'The Market keeps its leg, now third');
select is((select destination_name from schedule_legs where id = pg_temp.leg(2)), 'Port', 'The Port is leg 2');
select is((select count(*)::int from stop_taps where leg_id = pg_temp.id('leg1')), 2, 'The Driver''s taps are still there');
select is((select status from schedule_revisions where id = pg_temp.id('draft1')), 'SUPERSEDED', 'The approved draft is done with');
select ok((select active from schedule_requests where schedule_id = pg_temp.id('s1') and request_id = pg_temp.id('r2')), 'The new request is on the trip');
select is((select count(*)::int from notifications where type = 'TRIP_CHANGED' and account_id = '00000000-0000-0000-0000-00000000000e'), 1,
  'The Driver is told the trip changed');
select is((select count(*)::int from notifications where type = 'TRIP_PUBLISHED' and account_id = '00000000-0000-0000-0000-00000000000e'), 1,
  'Not that a new trip was published');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select lives_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg(2), 'ARRIVE') $$, 'The Driver can tap the new stop');

-- Changes that move a stop the Driver has reached ----------------------------------
select pg_temp.propose(array[pg_temp.id('r1'), pg_temp.id('r2')], jsonb_build_array(
  jsonb_build_object('id', pg_temp.leg(1), 'destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
    'stops', jsonb_build_array(pg_temp.id('r1_d1'))),
  jsonb_build_object('id', pg_temp.leg(2), 'destinationId', 'd3', 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:45',
    'stops', jsonb_build_array(pg_temp.id('r2_d3'))),
  jsonb_build_object('id', pg_temp.leg(3), 'destinationId', 'd2', 'plannedTimeOut', '11:00', 'plannedTimeIn', '12:00',
    'stops', jsonb_build_array(pg_temp.id('r1_d2'))),
  jsonb_build_object('id', pg_temp.leg(4), 'isFinal', true, 'plannedTimeOut', '12:30', 'plannedTimeIn', '13:30')));
select throws_ok($$ select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$, '22023',
  'The Driver has already reached a stop this change moves. Return it to the Scheduler to redo', 'A reached stop''s times can''t change');
select is((select planned_time_in from schedule_legs where id = pg_temp.leg(2)), '10:30'::time, 'The Driver''s route is untouched');
select lives_ok($$ select return_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')), 'The Driver is already at the Port') $$,
  'The Admin returns it instead');

-- City Hall sent as a new leg: the reached one would go.
select pg_temp.propose(array[pg_temp.id('r1'), pg_temp.id('r2')], jsonb_build_array(
  jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
    'stops', jsonb_build_array(pg_temp.id('r1_d1'))),
  jsonb_build_object('id', pg_temp.leg(2), 'destinationId', 'd3', 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30',
    'stops', jsonb_build_array(pg_temp.id('r2_d3'))),
  jsonb_build_object('id', pg_temp.leg(3), 'destinationId', 'd2', 'plannedTimeOut', '11:00', 'plannedTimeIn', '12:00',
    'stops', jsonb_build_array(pg_temp.id('r1_d2'))),
  jsonb_build_object('id', pg_temp.leg(4), 'isFinal', true, 'plannedTimeOut', '12:30', 'plannedTimeIn', '13:30')));
select throws_ok($$ select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$, '22023', null,
  'Nor can a reached stop be removed');

-- The backstop -------------------------------------------------------------------
reset role;
select throws_ok($$ update schedule_revisions set status = 'APPROVED' where schedule_id = pg_temp.id('s1') and status = 'SUBMITTED' $$,
  '22023', null, 'No other version can become the approved one on a started trip');

-- After End trip ------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select record_trip_attendance(pg_temp.id('s1'), 'END');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$,
  '22023', 'This trip has already ended', 'Changes can''t be approved once the trip has ended');

select * from finish();
rollback;

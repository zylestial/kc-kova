-- Tasks at a stop (0088): between Arrived and Leaving, each request is Done or
-- reported Not yet done, and Leaving waits until each has an answer.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-00000000000f', 'driver2@test.local'),
  ('00000000-0000-0000-0000-000000000010', 'driver3@test.local'),
  ('00000000-0000-0000-0000-000000000011', 'driver4@test.local'),
  ('00000000-0000-0000-0000-000000000012', 'driver5@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'req1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'req2@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-00000000000f', 'driver2', 'Dee Driver', 'Driver'),
  ('00000000-0000-0000-0000-000000000010', 'driver3', 'Dom Driver', 'Driver'),
  ('00000000-0000-0000-0000-000000000011', 'driver4', 'Dot Driver', 'Driver'),
  ('00000000-0000-0000-0000-000000000012', 'driver5', 'Del Driver', 'Driver'),
  ('00000000-0000-0000-0000-0000000000b1', 'req1', 'Rita Requester', 'Requester'),
  ('00000000-0000-0000-0000-0000000000b2', 'req2', 'Rob Requester', 'Requester');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e'),
  ('V2', 'Van 2', '00000000-0000-0000-0000-00000000000f'),
  ('V3', 'Van 3', '00000000-0000-0000-0000-000000000010'),
  ('V4', 'Van 4', '00000000-0000-0000-0000-000000000011'),
  ('V5', 'Van 5', '00000000-0000-0000-0000-000000000012');
insert into booking_options ("group", id, name, status, is_other_stop) values
  ('destinations', 'd1', 'Wilcon', 'Active', false),
  ('destinations', 'd2', 'Site A', 'Active', false),
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
-- A new request by Rita (or Rob for req2).
create function pg_temp.new_request(p_k text, p_owner uuid, p_place text default 'd1') returns void language plpgsql as $$
begin
  perform pg_temp.act_as(p_owner);
  insert into ids select p_k, id from create_request(pg_temp.today(), 'URGENT', null, null, jsonb_build_array(jsonb_build_object('destinationId', p_place, 'purposeId', 'p1')), null);
  reset role;
end;
$$;
-- An approved trip: Wilcon (two requests), Site A, back to ANONANG.
create function pg_temp.new_trip(p_k text, p_plate text, p_a text, p_b text, p_c text) returns void language plpgsql as $$
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
  insert into ids select p_k, schedule_id from save_schedule_draft(null, null, pg_temp.today(), p_plate,
    array[pg_temp.id(p_a), pg_temp.id(p_b), pg_temp.id(p_c)], jsonb_build_array(
      jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00', 'stops', pg_temp.stops_of(p_a) || pg_temp.stops_of(p_b)),
      jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:00', 'stops', pg_temp.stops_of(p_c)),
      jsonb_build_object('isFinal', true, 'plannedTimeOut', '10:15', 'plannedTimeIn', '11:00')));
  perform submit_schedule(pg_temp.id(p_k), (select row_version from schedule_revisions where schedule_id = pg_temp.id(p_k) and status = 'DRAFT'));
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
  perform approve_schedule(pg_temp.id(p_k), (select row_version from schedule_revisions where schedule_id = pg_temp.id(p_k) and status = 'SUBMITTED'));
  reset role;
end;
$$;

select pg_temp.new_request('a1', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.new_request('a2', '00000000-0000-0000-0000-0000000000b2');
select pg_temp.new_request('a3', '00000000-0000-0000-0000-0000000000b1', 'd2');
select pg_temp.new_trip('s1', 'V1', 'a1', 'a2', 'a3');

-- Done and Leaving -----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select record_trip_attendance(pg_temp.id('s1'), 'START');
select throws_ok($$ select record_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a1')) $$,
  '22023', 'Tap Arrived at this stop first', 'Done needs Arrived first');
select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'ARRIVE');
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'LEAVE') $$,
  '22023', 'Mark each task here as Done or Not yet done first', 'Leaving is locked with no task marked');
select lives_ok($$ select record_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a1')) $$, 'The Driver marks one Done');
select throws_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'LEAVE') $$,
  '22023', 'Mark each task here as Done or Not yet done first', 'Leaving is still locked with one left');
select throws_ok($$ select record_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a3')) $$,
  'P0002', 'That task isn''t at this stop any more', 'A request at another stop can''t be marked here');
select is((select count(*)::int from (select record_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a1'))) t), 1, 'A repeat is fine');
reset role;
select is((select count(*)::int from stop_tasks where schedule_id = pg_temp.id('s1')), 1, 'and keeps one row');

-- Undo
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select throws_ok($$ select undo_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a1')) $$,
  'P0002', 'Trip not found', 'Another Driver can''t undo it');
select throws_ok($$ select record_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a2')) $$,
  'P0002', 'Trip not found', 'or mark it');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select lives_ok($$ select undo_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a1')) $$, 'Undo takes it back');
select lives_ok($$ select undo_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a1')) $$, 'twice does nothing');
reset role;
select is((select count(*)::int from stop_tasks where schedule_id = pg_temp.id('s1')), 0, 'The row is gone');

-- Direct writes stay closed.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ insert into stop_tasks (schedule_id, revision_id, leg_id, request_id, recorded_by_account_id)
  select pg_temp.id('s1'), revision_id, id, pg_temp.id('a1'), auth.uid() from schedule_legs where id = pg_temp.leg('s1', 1) $$,
  '42501', null, 'Writes go through the functions');

select lives_ok($$ select record_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a1')) $$, 'Done again');
select lives_ok($$ select record_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a2')) $$, 'and the other');
select lives_ok($$ select record_stop_tap(pg_temp.id('s1'), pg_temp.leg('s1', 1), 'LEAVE') $$, 'Leaving opens once each has an answer');
select throws_ok($$ select undo_stop_task(pg_temp.id('s1'), pg_temp.leg('s1', 1), pg_temp.id('a2')) $$,
  '22023', 'You already left this stop', 'No Undo after Leaving');

-- Who can read it
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from stop_tasks where schedule_id = pg_temp.id('s1')), 1, 'A requester sees their own request''s Done');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select is((select count(*)::int from stop_tasks where schedule_id = pg_temp.id('s1')), 0, 'Another Driver sees none');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from stop_tasks where schedule_id = pg_temp.id('s1')), 2, 'The Scheduler sees all');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select is((select count(*)::int from stop_tasks where schedule_id = pg_temp.id('s1')), 2, 'and the trip''s Driver');
reset role;

-- Not yet done -----------------------------------------------------------------
select pg_temp.new_request('b1', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.new_request('b2', '00000000-0000-0000-0000-0000000000b2');
select pg_temp.new_request('b3', '00000000-0000-0000-0000-0000000000b1', 'd2');
select pg_temp.new_trip('s2', 'V2', 'b1', 'b2', 'b3');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select record_trip_attendance(pg_temp.id('s2'), 'START');
select record_stop_tap(pg_temp.id('s2'), pg_temp.leg('s2', 1), 'ARRIVE');
insert into ids select 'rb1', id from report_stop(pg_temp.id('s2'), pg_temp.leg('s2', 1), 'NOT_READY', 'Not paid yet', false, null, null, null, array[pg_temp.id('b1')]);
select throws_ok($$ select record_stop_task(pg_temp.id('s2'), pg_temp.leg('s2', 1), pg_temp.id('b1')) $$,
  '22023', 'Wait for the Scheduler''s answer on this one', 'A task reported can''t be marked Done while waiting');
select lives_ok($$ select record_stop_task(pg_temp.id('s2'), pg_temp.leg('s2', 1), pg_temp.id('b2')) $$, 'The other one can, while the trip is held');
select throws_ok($$ select report_stop(pg_temp.id('s2'), pg_temp.leg('s2', 1), 'OTHER', '', false, null, null, null, array[pg_temp.id('b2')]) $$,
  '22023', 'That task is marked Done. Tap Undo first', 'A task marked Done can''t be reported');

-- Wait there: back to Done or Not yet done.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select answer_stop_report(pg_temp.id('rb1'), 'WAIT');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select throws_ok($$ select record_stop_tap(pg_temp.id('s2'), pg_temp.leg('s2', 1), 'LEAVE') $$,
  '22023', 'Mark each task here as Done or Not yet done first', 'After Wait there, the task still needs marking');
insert into ids select 'rb2', id from report_stop(pg_temp.id('s2'), pg_temp.leg('s2', 1), 'NOT_READY', 'Still no', false, null, null, null, array[pg_temp.id('b1')]);

-- Skip: that task is settled.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select answer_stop_report(pg_temp.id('rb2'), 'SKIP');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000f');
select throws_ok($$ select record_stop_task(pg_temp.id('s2'), pg_temp.leg('s2', 1), pg_temp.id('b1')) $$,
  '22023', 'The Scheduler skipped this one', 'A skipped task can''t be marked Done');
select lives_ok($$ select record_stop_tap(pg_temp.id('s2'), pg_temp.leg('s2', 1), 'LEAVE') $$, 'Leaving opens after Skip');
reset role;

-- A problem for the whole stop, with one task Done --------------------------------
select pg_temp.new_request('c1', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.new_request('c2', '00000000-0000-0000-0000-0000000000b2');
select pg_temp.new_request('c3', '00000000-0000-0000-0000-0000000000b1', 'd2');
select pg_temp.new_trip('s3', 'V3', 'c1', 'c2', 'c3');
select pg_temp.act_as('00000000-0000-0000-0000-000000000010');
select record_trip_attendance(pg_temp.id('s3'), 'START');
select record_stop_tap(pg_temp.id('s3'), pg_temp.leg('s3', 1), 'ARRIVE');
select record_stop_task(pg_temp.id('s3'), pg_temp.leg('s3', 1), pg_temp.id('c1'));
insert into ids select 'rc', id from report_stop(pg_temp.id('s3'), pg_temp.leg('s3', 1), 'VEHICLE_PROBLEM', 'Flat tire');
reset role;
select is((select request_ids = array[pg_temp.id('c2')] from problem_reports where id = pg_temp.id('rc')), true,
  'It covers only the task not Done');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select answer_stop_report(pg_temp.id('rc'), 'SKIP');
reset role;
select ok(not leg_missed(pg_temp.leg('s3', 1)), 'Skip doesn''t make the whole stop missed');
select is((select status || ' ' || decision from problem_reports where id = pg_temp.id('rc')), 'OPEN SKIP', 'Only that one waits to be planned again');
select is((select count(*)::int from stop_tasks where request_id = pg_temp.id('c1')), 1, 'The job marked Done stays marked');
select pg_temp.act_as('00000000-0000-0000-0000-000000000010');
select lives_ok($$ select record_stop_tap(pg_temp.id('s3'), pg_temp.leg('s3', 1), 'LEAVE') $$, 'and the Driver can leave');
select record_stop_tap(pg_temp.id('s3'), pg_temp.leg('s3', 2), 'ARRIVE');
select record_stop_task(pg_temp.id('s3'), pg_temp.leg('s3', 2), pg_temp.id('c3'));
select throws_ok($$ select report_stop(pg_temp.id('s3'), pg_temp.leg('s3', 2), 'VEHICLE_PROBLEM', 'Flat tire') $$,
  '22023', 'Every task here is done. Tap Leaving, then report it at the next stop', 'With every task done there''s nothing here to report');
reset role;

-- End trip now with tasks not answered --------------------------------------------
select pg_temp.new_request('e1', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.new_request('e2', '00000000-0000-0000-0000-0000000000b2');
select pg_temp.new_request('e3', '00000000-0000-0000-0000-0000000000b1', 'd2');
select pg_temp.new_trip('s4', 'V4', 'e1', 'e2', 'e3');
select pg_temp.act_as('00000000-0000-0000-0000-000000000011');
select record_trip_attendance(pg_temp.id('s4'), 'START');
select record_stop_tap(pg_temp.id('s4'), pg_temp.leg('s4', 1), 'ARRIVE');
select record_stop_task(pg_temp.id('s4'), pg_temp.leg('s4', 1), pg_temp.id('e1'));
select record_trip_attendance(pg_temp.id('s4'), 'END');
reset role;
select is((select count(*)::int from stop_tasks where request_id = pg_temp.id('e1')), 1, 'End trip now: the job marked Done stays marked');
select ok(not leg_missed(pg_temp.leg('s4', 1)), 'and the stop isn''t missed as a whole');
select is((select row(decision, request_ids = array[pg_temp.id('e2')], decided_by_account_id is null, status)::text from problem_reports
  where schedule_id = pg_temp.id('s4') and leg_id = pg_temp.leg('s4', 1)), '(SKIP,t,t,OPEN)', 'as a Skip nobody chose, naming just that one');
select is((select count(*)::int from problem_reports where schedule_id = pg_temp.id('s4') and leg_id = pg_temp.leg('s4', 2) and kind = 'NOT_REACHED'), 1,
  'The stop not reached is still Not reached');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok($$ select mark_stop_report_done((select id from problem_reports where schedule_id = pg_temp.id('s4') and leg_id = pg_temp.leg('s4', 1))) $$,
  'Got it, it was done clears it');
reset role;

-- A saved tap keeps the phone's time, not before Arrived ----------------------------
select pg_temp.new_request('f1', '00000000-0000-0000-0000-0000000000b1');
select pg_temp.new_request('f2', '00000000-0000-0000-0000-0000000000b2');
select pg_temp.new_request('f3', '00000000-0000-0000-0000-0000000000b1', 'd2');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 's5', schedule_id from save_schedule_draft(null, null, pg_temp.today(), 'V5',
  array[pg_temp.id('f1'), pg_temp.id('f2'), pg_temp.id('f3')], jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '13:00', 'plannedTimeIn', '14:00', 'stops', pg_temp.stops_of('f1') || pg_temp.stops_of('f2')),
    jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '14:30', 'plannedTimeIn', '15:00', 'stops', pg_temp.stops_of('f3')),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '15:15', 'plannedTimeIn', '16:00')));
select submit_schedule(pg_temp.id('s5'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('s5') and status = 'DRAFT'));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('s5'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('s5') and status = 'SUBMITTED'));
select pg_temp.act_as('00000000-0000-0000-0000-000000000012');
select record_trip_attendance(pg_temp.id('s5'), 'START');
select record_stop_tap(pg_temp.id('s5'), pg_temp.leg('s5', 1), 'ARRIVE');
select record_stop_task_at(now() - interval '1 day', pg_temp.id('s5'), pg_temp.leg('s5', 1), pg_temp.id('f1'));
reset role;
select is((select at = (select t.at from stop_taps t where t.leg_id = pg_temp.leg('s5', 1) and t.kind = 'ARRIVE') from stop_tasks where request_id = pg_temp.id('f1')),
  true, 'A saved Done can''t read before Arrived');
select ok((select sent_at is not null from stop_tasks where request_id = pg_temp.id('f1')), 'and notes when it arrived');

-- A stop Arrived at before tasks existed ----------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-000000000012');
select record_stop_task(pg_temp.id('s5'), pg_temp.leg('s5', 1), pg_temp.id('f2'));
select record_stop_tap(pg_temp.id('s5'), pg_temp.leg('s5', 1), 'LEAVE');
select record_stop_tap(pg_temp.id('s5'), pg_temp.leg('s5', 2), 'ARRIVE');
select throws_ok($$ select record_stop_tap(pg_temp.id('s5'), pg_temp.leg('s5', 2), 'LEAVE') $$,
  '22023', 'Mark each task here as Done or Not yet done first', 'A new Arrived needs its task marked');
reset role;
update stop_taps set before_tasks = true where leg_id = pg_temp.leg('s5', 2) and kind = 'ARRIVE';
select pg_temp.act_as('00000000-0000-0000-0000-000000000012');
select lives_ok($$ select record_stop_tap(pg_temp.id('s5'), pg_temp.leg('s5', 2), 'LEAVE') $$, 'A stop Arrived at before tasks leaves as it used to');
reset role;

-- A Company trip's last stop has no Arrived or Leaving: End trip waits ----------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000001a1', 'rhea3@test.local'),
  ('00000000-0000-0000-0000-0000000001a5', 'jun3@test.local');
insert into accounts (id, username, name, role, position, can_request_company) values
  ('00000000-0000-0000-0000-0000000001a1', 'rhea3', 'Rhea Santos', 'Requester', 'Purchasing Officer', true);
insert into accounts (id, username, name, role, driver_type) values
  ('00000000-0000-0000-0000-0000000001a5', 'jun3', 'Jun Reyes', 'Driver', 'Company car');
insert into vehicles (plate, name, company_trips) values ('TM', 'Mirage', true);
insert into booking_options ("group", id, name, status, is_other_stop) values
  ('starting_points', 'tsp', 'Main Office', 'Active', false),
  ('departments', 'tdep', 'Purchasing', 'Active', false),
  ('supervisors', 'tsup', 'A Supervisor', 'Active', false),
  ('heads', 'th', 'A Head', 'Active', false),
  ('projects', 'tp', 'Project', 'Active', false),
  ('purposes', 'tpu', 'Submission', 'Active', false);

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
insert into ids select 'g', (create_request_group('COMPANY', jsonb_build_object(
  'date', pg_temp.today(), 'startingPointId', 'tsp', 'departmentId', 'tdep', 'vehiclePlate', 'TM',
  'driverId', '00000000-0000-0000-0000-0000000001a5', 'supervisorId', 'tsup', 'headId', 'th',
  'stops', jsonb_build_array(
    jsonb_build_object('projectId', 'tp', 'destinationId', 'd1', 'purposeId', 'tpu'),
    jsonb_build_object('projectId', 'tp', 'destinationId', 'd2', 'purposeId', 'tpu'))))).id;
reset role;
insert into ids select 'g-a', id from requests where group_id = pg_temp.id('g') and stop_letter = 'A';
insert into ids select 'g-b', id from requests where group_id = pg_temp.id('g') and stop_letter = 'B';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 'co', (create_company_trip(pg_temp.today(), 'TM',
  array[pg_temp.id('g-a'), pg_temp.id('g-b')], jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '08:30', 'stops', pg_temp.stops_of('g-a')),
    jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '09:00', 'plannedTimeIn', '09:30', 'stops', pg_temp.stops_of('g-b'))))).schedule_id;
select submit_schedule(pg_temp.id('co'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('co')));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('co'), (select row_version from schedule_revisions where schedule_id = pg_temp.id('co') and status = 'SUBMITTED'));

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a5');
select start_company_trip(pg_temp.id('co'), 100);
select record_company_stop(pg_temp.id('co'), pg_temp.leg('co', 1), 'ARRIVE');
select throws_ok($$ select record_company_stop(pg_temp.id('co'), pg_temp.leg('co', 1), 'LEAVE') $$,
  '22023', 'Mark each task here as Done or Not yet done first', 'A Company trip''s Leaving is locked too');
select throws_ok($$ select record_stop_task(pg_temp.id('co'), pg_temp.leg('co', 2), pg_temp.id('g-b')) $$,
  '22023', 'Tap Leaving the stop before this one first', 'The last stop can''t be marked before leaving the one before');
select record_stop_task(pg_temp.id('co'), pg_temp.leg('co', 1), pg_temp.id('g-a'));
select record_company_stop(pg_temp.id('co'), pg_temp.leg('co', 1), 'LEAVE');
select throws_ok($$ select end_company_trip(pg_temp.id('co'), 120) $$,
  '22023', 'Mark each task here as Done or Not yet done first', 'End trip waits for the last stop''s task');
select lives_ok($$ select record_stop_task(pg_temp.id('co'), pg_temp.leg('co', 2), pg_temp.id('g-b')) $$, 'The last stop''s task, with no Arrived tap');
select lives_ok($$ select end_company_trip(pg_temp.id('co'), 120) $$, 'End trip opens');
select throws_ok($$ select record_stop_task(pg_temp.id('co'), pg_temp.leg('co', 1), pg_temp.id('g-a')) $$,
  '22023', 'This trip has ended', 'Nothing can be marked after the trip ends');
reset role;

select * from finish();
rollback;

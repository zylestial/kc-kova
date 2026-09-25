-- v2 Admin finished trips: correct_completion, mark_completion_done,
-- handle_problem, role limits, done lock, follow-up link, audit history.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

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
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd1', 'City Hall', 'Active'),
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

-- past: Admin request for yesterday, V1 (Dan). future: Juan's request in
-- 10 days, V2 (Dee).
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into ids select 'past', id from create_request(pg_temp.manila_today() - 1, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into ids select 'future', id from create_request(pg_temp.manila_today() + 10, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]');
reset role;
insert into ids select k || '_rd', (select id from request_destinations where request_id = v and active) from ids;

create function pg_temp.publish(p_plate text, p_date date, p_request text) returns uuid language plpgsql as $$
declare
  v_revision schedule_revisions;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
  select * into v_revision from save_schedule_draft(null, null, p_date, p_plate, array[pg_temp.id(p_request)],
    jsonb_build_array(
      jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
        'stops', jsonb_build_array(pg_temp.id(p_request || '_rd'))),
      jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30')));
  perform submit_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
  perform approve_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  reset role;
  return v_revision.schedule_id;
end;
$$;
insert into ids values ('sp', pg_temp.publish('V1', pg_temp.manila_today() - 1, 'past'));
insert into ids values ('sf', pg_temp.publish('V2', pg_temp.manila_today() + 10, 'future'));

-- Setup: Dan completes the past trip and files two problems; Dee's future
-- trip (sf) is the follow-up candidate.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select submit_completion(pg_temp.id('sp'), 1000, 1042);
insert into ids select 'p1', id from report_problem(pg_temp.id('sp'), 'Flat tyre');
insert into ids select 'p2', id from report_problem(pg_temp.id('sp'), 'Broken mirror');

-- Who may act -------------------------------------------------------------------
select throws_ok($$ select correct_completion(pg_temp.id('sp'), 1, 2) $$, '42501', null, 'Driver cannot correct a completion');
select throws_ok($$ select mark_completion_done(pg_temp.id('sp')) $$, '42501', null, 'Driver cannot mark a completion done');
select throws_ok($$ select handle_problem(pg_temp.id('p1'), 'Fixed', null) $$, '42501', null, 'Driver cannot handle a problem');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select correct_completion(pg_temp.id('sp'), 1, 2) $$, '42501', null, 'Scheduler cannot correct a completion');
select throws_ok($$ select handle_problem(pg_temp.id('p1'), 'Fixed', null) $$, '42501', null, 'Scheduler cannot handle a problem');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select mark_completion_done(pg_temp.id('sp')) $$, '42501', null, 'Requester cannot mark a completion done');

-- Correcting ----------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select correct_completion(gen_random_uuid(), 1, 2) $$, 'P0002', null, 'Unknown schedule is not found');
select throws_ok($$ select correct_completion(pg_temp.id('sf'), 1, 2) $$, 'P0002', null, 'A trip without a completion has nothing to correct');
select throws_ok($$ select correct_completion(pg_temp.id('sp'), 200, 100) $$, '22023', null, 'End odometer below start is refused');
select throws_ok($$ select correct_completion(pg_temp.id('sp'), null, 100) $$, '22023', null, 'Missing odometer is refused');
select lives_ok($$ select correct_completion(pg_temp.id('sp'), 1010, 1060) $$, 'Admin corrects a submitted completion');
select is((select distance from trip_completions where schedule_id = pg_temp.id('sp')), 50, 'The corrected distance is derived');
select is((select status from trip_completions where schedule_id = pg_temp.id('sp')), 'SUBMITTED', 'Correcting leaves it SUBMITTED');

-- Marking done ---------------------------------------------------------------------
select throws_ok($$ select mark_completion_done(pg_temp.id('sf')) $$, 'P0002', null, 'A trip without a completion can''t be marked done');
select lives_ok($$ select mark_completion_done(pg_temp.id('sp')) $$, 'Admin marks a completion done');
select is((select status from trip_completions where schedule_id = pg_temp.id('sp')), 'DONE', 'It is DONE');
select is((select done_by_account_id from trip_completions where schedule_id = pg_temp.id('sp')),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'The Admin who marked it is recorded');
select is((select done_at is not null from mark_completion_done(pg_temp.id('sp'))), true, 'Repeating returns the existing DONE completion');
select throws_ok($$ select correct_completion(pg_temp.id('sp'), 1, 2) $$, '22023', null, 'A done completion can''t be corrected');
select is((select start_odometer from trip_completions where schedule_id = pg_temp.id('sp')), 1010, 'The refused correction changed nothing');

-- Handling problems ------------------------------------------------------------------
select throws_ok($$ select handle_problem(gen_random_uuid(), 'Fixed', null) $$, 'P0002', null, 'Unknown problem report is not found');
select throws_ok($$ select handle_problem(pg_temp.id('p1'), '   ', null) $$, '22023', null, 'A blank handling note is refused');
select throws_ok($$ select handle_problem(pg_temp.id('p1'), 'Fixed', pg_temp.id('sp')) $$, '22023', null, 'The follow-up can''t be the same schedule');
select throws_ok($$ select handle_problem(pg_temp.id('p1'), 'Fixed', gen_random_uuid()) $$, 'P0002', null, 'An unknown follow-up schedule is refused');
select lives_ok($$ select handle_problem(pg_temp.id('p1'), '  Tyre replaced  ', pg_temp.id('sf')) $$, 'Admin handles a problem on a done trip, with a follow-up');
select is((select status || '|' || handling_note from problem_reports where id = pg_temp.id('p1')), 'HANDLED|Tyre replaced', 'It is HANDLED and the note is trimmed');
select is((select follow_up_schedule_id from problem_reports where id = pg_temp.id('p1')), pg_temp.id('sf'), 'The follow-up is linked');
select is((select handled_by_account_id from problem_reports where id = pg_temp.id('p1')),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'The Admin who handled it is recorded');
select is((select handling_note from handle_problem(pg_temp.id('p1'), 'Different', null)), 'Tyre replaced', 'Repeating returns the handled report unchanged');
select lives_ok($$ select cancel_schedule(pg_temp.id('sf'), 'Vehicle unavailable') $$, 'Admin cancels the follow-up candidate');
select throws_ok($$ select handle_problem(pg_temp.id('p2'), 'Fixed', pg_temp.id('sf')) $$, '22023', null, 'A cancelled schedule can''t be the follow-up');
select is((select status from problem_reports where id = pg_temp.id('p2')), 'OPEN', 'The other problem report stays OPEN');

-- Direct writes and history ----------------------------------------------------------
reset role;
select throws_ok($$ update trip_completions set end_odometer = 9999 where schedule_id = pg_temp.id('sp') $$, '22023', null,
  'Even the service role can''t change a done completion');
select throws_ok($$ update problem_reports set follow_up_schedule_id = pg_temp.id('sf') where id = pg_temp.id('p2') $$, '23514', null,
  'Only a handled report can carry a follow-up');
select is((select count(*)::int from audit_events where action in ('completion.correct', 'completion.done', 'problem.handle')), 3,
  'Correction, done and handling are in audit history');

select * from finish();
rollback;

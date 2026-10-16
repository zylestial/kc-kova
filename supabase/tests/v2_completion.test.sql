-- v2 driver completion: submit_completion, report_problem, role and
-- ownership limits, trip-ended rule, idempotency, locks after submission.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'juan@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-000000000010', 'driver2@test.local'),
  ('00000000-0000-0000-0000-000000000011', 'driver3@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000b', 'juan', 'Juan', 'Requester'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-000000000010', 'driver2', 'Dee Driver', 'Driver'),
  ('00000000-0000-0000-0000-000000000011', 'driver3', 'Dot Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e'),
  ('V2', 'Van 2', '00000000-0000-0000-0000-000000000010'),
  ('V3', 'Van 3', '00000000-0000-0000-0000-000000000011');
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
insert into ids select 'past', id from create_request(pg_temp.manila_today() - 1, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into ids select 'future', id from create_request(pg_temp.manila_today() + 10, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into ids select 'past2', id from create_request(pg_temp.manila_today() - 1, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
reset role;
insert into ids select k || '_rd', (select id from request_destinations where request_id = v and active) from ids;

create function pg_temp.publish(p_plate text, p_date date, p_request text, p_final_in text default '10:30') returns uuid language plpgsql as $$
declare
  v_revision schedule_revisions;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
  select * into v_revision from save_schedule_draft(null, null, p_date, p_plate, array[pg_temp.id(p_request)],
    jsonb_build_array(
      jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
        'stops', jsonb_build_array(pg_temp.id(p_request || '_rd'))),
      jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', p_final_in)));
  perform submit_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
  perform approve_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  reset role;
  return v_revision.schedule_id;
end;
$$;
insert into ids values ('sp', pg_temp.publish('V1', pg_temp.manila_today() - 1, 'past'));
insert into ids values ('sf', pg_temp.publish('V2', pg_temp.manila_today() + 10, 'future'));
insert into ids values ('sp2', pg_temp.publish('V3', pg_temp.manila_today() - 1, 'past2'));

-- Who may complete ----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select submit_completion(pg_temp.id('sp'), 100, 150) $$, '42501', null, 'Scheduler cannot submit a completion');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select submit_completion(pg_temp.id('sp'), 100, 150) $$, '42501', null, 'Requester cannot submit a completion');
select throws_ok($$ select report_problem(pg_temp.id('sp'), 'Flat tyre') $$, '42501', null, 'Requester cannot report a problem');
select pg_temp.act_as('00000000-0000-0000-0000-000000000010');
select throws_ok($$ select submit_completion(pg_temp.id('sp'), 100, 150) $$, 'P0002', null, 'Another Driver cannot complete it');
select throws_ok($$ select report_problem(pg_temp.id('sp'), 'Flat tyre') $$, 'P0002', null, 'Another Driver cannot report on it');

-- Validation ----------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select submit_completion(pg_temp.id('sp'), 150, 100) $$, '22023', null, 'End odometer below start is refused');
select throws_ok($$ select submit_completion(pg_temp.id('sp'), -1, 100) $$, '22023', null, 'Negative start odometer is refused');
select throws_ok($$ select submit_completion(pg_temp.id('sp'), null, 100) $$, '22023', null, 'Missing odometer is refused');
select throws_ok($$ select report_problem(pg_temp.id('sp'), '   ') $$, '22023', null, 'A blank problem note is refused');
select throws_ok($$ select submit_completion(gen_random_uuid(), 100, 150) $$, 'P0002', null, 'Unknown schedule is not found');
select pg_temp.act_as('00000000-0000-0000-0000-000000000010');
select throws_ok($$ select submit_completion(pg_temp.id('sf'), 100, 150) $$, '22023', null, 'A trip without End trip can''t be completed');

-- Back at ANONANG early (0047): End trip is enough; the last planned Time In
-- (23:59 today) needn't have passed.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into ids select 'today', id from create_request(pg_temp.manila_today(), 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
reset role;
insert into ids select 'today_rd', id from request_destinations where request_id = pg_temp.id('today') and active;
insert into ids values ('st', pg_temp.publish('V1', pg_temp.manila_today(), 'today', '23:59'));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select record_trip_attendance(pg_temp.id('st'), 'START');
select record_trip_attendance(pg_temp.id('st'), 'END');
select lives_ok($$ select submit_completion(pg_temp.id('st'), 500, 520) $$, 'A trip ended at ANONANG can be completed before its planned end');
select pg_temp.act_as('00000000-0000-0000-0000-000000000010');

-- Problem reports -----------------------------------------------------------
select lives_ok($$ select report_problem(pg_temp.id('sf'), '  Road closed  ') $$, 'The Driver reports a problem before the trip ends');
select is((select note from problem_reports where schedule_id = pg_temp.id('sf')), 'Road closed', 'The note is trimmed');
select is((select status from problem_reports where schedule_id = pg_temp.id('sf')), 'OPEN', 'It starts OPEN');
select lives_ok($$ select report_problem(pg_temp.id('sf'), 'Still closed') $$, 'A second report is allowed');
select is((select count(*)::int from trip_completions where schedule_id = pg_temp.id('sf')), 0, 'A problem report does not complete the trip');

-- Completion ----------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select submit_completion(pg_temp.id('sp'), 1000, 1042) $$, '22023', null,
  'A trip without Start and End taps can''t be completed');
select record_trip_attendance(pg_temp.id('sp'), 'START', 16.103769, 120.436222, 10);
select record_trip_attendance(pg_temp.id('sp'), 'END', 16.103769, 120.436222, 10);
select lives_ok($$ select submit_completion(pg_temp.id('sp'), 1000, 1042) $$, 'The Driver completes an ended trip');
select is((select distance from trip_completions where schedule_id = pg_temp.id('sp')), 42, 'Distance is derived');
select is((select status from trip_completions where schedule_id = pg_temp.id('sp')), 'SUBMITTED', 'It starts SUBMITTED');
select is((select full_tank from trip_completions where schedule_id = pg_temp.id('sp')), null,
  'Full tank defaults to unanswered when not given');
select is((select fleet_card_used from trip_completions where schedule_id = pg_temp.id('sp')), null,
  'Fleet card used defaults to unanswered when not given');
select is((select revision_id from trip_completions where schedule_id = pg_temp.id('sp')),
  (select published_revision_id from schedules where id = pg_temp.id('sp')), 'It pins the approved version');
select is((select start_odometer from submit_completion(pg_temp.id('sp'), 5, 9)), 1000, 'Repeating returns the existing completion');
select is((select count(*)::int from trip_completions where schedule_id = pg_temp.id('sp')), 1, 'There is still one completion');

-- Admin view-as-Driver override: not scoped to the assigned Driver ----------
-- sp2 is Dot Driver's (driver3) trip, not Admin's -- Admin has no driver_id
-- of their own, so the ownership check must accept Admin for any vehicle.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select report_problem(pg_temp.id('sp2'), 'Checking in as Admin') $$,
  'Admin reports a problem on a trip not assigned to them');
select is((select driver_id from problem_reports where schedule_id = pg_temp.id('sp2')),
  '00000000-0000-0000-0000-00000000000a', 'The report is attributed to Admin, not the real Driver');
select ok(
  (select is_admin_override from audit_events
   where table_name = 'problem_reports' and record_id = (select id from problem_reports where schedule_id = pg_temp.id('sp2'))),
  'The Admin problem report is audited with is_admin_override');
select record_trip_attendance(pg_temp.id('sp2'), 'START');
select record_trip_attendance(pg_temp.id('sp2'), 'END');
select lives_ok($$ select submit_completion(pg_temp.id('sp2'), 200, 260, true, true, false) $$,
  'Admin completes a trip not assigned to them, answering the return checks');
select is((select driver_id from trip_completions where schedule_id = pg_temp.id('sp2')),
  '00000000-0000-0000-0000-00000000000a', 'The completion is attributed to Admin, not the real Driver');
select is((select full_tank from trip_completions where schedule_id = pg_temp.id('sp2')), true, 'Full tank is recorded true');
select is((select fleet_card_used from trip_completions where schedule_id = pg_temp.id('sp2')), true, 'Fleet card used is recorded true');
select is((select gas_receipt_attached from trip_completions where schedule_id = pg_temp.id('sp2')), false, 'Gas receipt attached is recorded false');
select ok(
  (select is_admin_override from audit_events
   where table_name = 'trip_completions' and record_id = (select id from trip_completions where schedule_id = pg_temp.id('sp2'))),
  'The Admin completion is audited with is_admin_override');
select pg_temp.act_as('00000000-0000-0000-0000-000000000011');
select is((select start_odometer from submit_completion(pg_temp.id('sp2'), 1, 5)), 200,
  'The real Driver repeating it gets back Admin''s completion, not a new one');

-- Locks after submission ------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select cancel_schedule(pg_temp.id('sp'), 'Oops') $$, '22023', null, 'A completed trip can''t be cancelled');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok(format($$ select save_schedule_draft(%L, null, null, null, null, null) $$, pg_temp.id('sp')), '22023', null,
  'A completed trip can''t be revised');
reset role;
select is((select count(*)::int from audit_events where action in ('completion.submit', 'problem.report')), 6,
  'Completion and problem reports, Driver and Admin override alike, are in audit history');
select is((select count(*)::int from problem_reports where status = 'OPEN' and leg_id is null), 3, 'All three reports exist, still OPEN');

select * from finish();
rollback;

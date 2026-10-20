-- Finance reads trips, finished-trip details and attendance, and changes
-- nothing (0076_finance_read_access.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'fadmin@test.local'),
  ('00000000-0000-0000-0000-0000000007a2', 'fsched@test.local'),
  ('00000000-0000-0000-0000-0000000007a3', 'fdriver@test.local'),
  ('00000000-0000-0000-0000-0000000007a4', 'ffin@test.local'),
  ('00000000-0000-0000-0000-0000000007a5', 'freq@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000007a1', 'fadmin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-0000000007a2', 'fsched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000007a3', 'fdriver', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-0000000007a4', 'ffin', 'Fe Finance', 'Finance'),
  ('00000000-0000-0000-0000-0000000007a5', 'freq', 'Rae Requester', 'Requester');
insert into vehicles (plate, name, assigned_driver_id) values
  ('FV1', 'Van F', '00000000-0000-0000-0000-0000000007a3');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'fd1', 'City Hall', 'Active'),
  ('purposes', 'fp1', 'Inspection', 'Active');

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

-- Yesterday's trip on FV1: requested, planned, approved, driven, completed,
-- with a problem report.
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
insert into ids select 'req', id from create_request(pg_temp.manila_today() - 1, 'REGULAR', null, null,
  '[{"destinationId":"fd1","purposeId":"fp1"}]', null);
reset role;
insert into ids select 'rd', id from request_destinations where request_id = pg_temp.id('req') and active;

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a2');
insert into ids select 'trip', schedule_id from save_schedule_draft(null, null, pg_temp.manila_today() - 1, 'FV1',
  array[pg_temp.id('req')],
  jsonb_build_array(
    jsonb_build_object('destinationId', 'fd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
      'stops', jsonb_build_array(pg_temp.id('rd'))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30')));
select submit_schedule(pg_temp.id('trip'), pg_temp.rv(pg_temp.id('trip')));
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select approve_schedule(pg_temp.id('trip'), pg_temp.rv(pg_temp.id('trip')));

select pg_temp.act_as('00000000-0000-0000-0000-0000000007a3');
select record_trip_attendance(pg_temp.id('trip'), 'START');
select record_stop_tap(pg_temp.id('trip'), l.id, 'ARRIVE')
from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
where s.id = pg_temp.id('trip') and l.leg_no = 1;
select record_trip_attendance(pg_temp.id('trip'), 'END');
select submit_completion(pg_temp.id('trip'), 1000, 1042);
insert into ids select 'prob', id from report_problem(pg_temp.id('trip'), 'Flat tyre');

-- Finance reads -------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a4');
select is((select count(*)::int from schedules where id = pg_temp.id('trip')), 1, 'Finance sees the trip');
select is((select count(*)::int from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id('trip')), 2, 'and its legs');
select is((select count(*)::int from requests where id = pg_temp.id('req')), 1, 'and the request on it');
select is((select distance from trip_completions where schedule_id = pg_temp.id('trip')), 42, 'and its odometer readings');
select is((select count(*)::int from trip_attendance where schedule_id = pg_temp.id('trip')), 1, 'and the Driver''s attendance');
select is((select count(*)::int from stop_taps where schedule_id = pg_temp.id('trip')), 1, 'and the stop taps');
select is((select count(*)::int from problem_reports where schedule_id = pg_temp.id('trip')), 1, 'and the problem report');
select is((select count(*)::int from request_cancellations), 0, 'but not cancellation asks');

-- Finance changes nothing ---------------------------------------------------
select throws_ok($$ select correct_completion(pg_temp.id('trip'), 1000, 1050) $$, '42501', null, 'Finance cannot correct a completion');
select throws_ok($$ select mark_completion_done(pg_temp.id('trip')) $$, '42501', null, 'nor mark it done');
select throws_ok($$ select handle_problem(pg_temp.id('prob'), 'Fixed', null) $$, '42501', null, 'nor handle a problem');
select throws_ok($$ select cancel_schedule(pg_temp.id('trip'), 'No') $$, '42501', null, 'nor cancel a trip');
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.manila_today() + 3, 'FV1', array[]::uuid[], '[]'::jsonb) $$,
  '42501', null, 'nor plan one');
select throws_ok($$ update trip_completions set end_odometer = 9999 $$, '42501', null, 'nor edit a table directly');
select is((select end_odometer from trip_completions where schedule_id = pg_temp.id('trip')), 1042, 'The reading is unchanged');

-- A Requester still sees only their own -------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a5');
select is((select count(*)::int from trip_completions), 0, 'A Requester still sees no finished-trip readings');

select * from finish();
rollback;

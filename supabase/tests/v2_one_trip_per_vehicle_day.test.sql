-- One trip per vehicle per day (0048): a vehicle on one schedule can't go on
-- another for the same day, even at other times; its own schedule may keep
-- it, and discarding the schedule frees it.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- These tests are about scheduling, not the vehicle a request names
-- (v2_request_vehicle.test.sql), so any vehicle may take any request here.
alter table revision_requests disable trigger revision_requests_request_vehicle;

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
  ('purposes', 'p1', 'Inspection', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.day() returns date language sql as $$ select (now() at time zone 'Asia/Manila')::date + 10; $$;
create function pg_temp.rv(p_schedule uuid) returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = p_schedule and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
-- A one-stop route for request p_request, leaving at p_out.
create function pg_temp.legs(p_request text, p_out text, p_in text, p_back text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', p_out, 'plannedTimeIn', p_in,
      'stops', jsonb_build_array(pg_temp.id(p_request || '_rd'))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', p_in, 'plannedTimeIn', p_back));
$$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into ids select 'r1', id from create_request(pg_temp.day(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', 'V1');
insert into ids select 'r2', id from create_request(pg_temp.day(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', 'V1');
reset role;
insert into ids select k || '_rd', (select id from request_destinations where request_id = v and active) from ids;

-- s1: V1 in the morning.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 's1', schedule_id from save_schedule_draft(null, null, pg_temp.day(), 'V1', array[pg_temp.id('r1')],
  pg_temp.legs('r1', '08:00', '09:00', '10:00'));

-- Tests --------------------------------------------------------------------
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.day(), 'V1', array[pg_temp.id('r2')], pg_temp.legs('r2', '13:00', '14:00', '15:00')) $$,
  '23P01', 'V1 already has a trip on this day. Choose another vehicle.',
  'Another schedule can''t use V1 that day, even in the afternoon');
select lives_ok(
  $$ insert into ids select 's2', schedule_id from save_schedule_draft(null, null, pg_temp.day(), 'V2', array[pg_temp.id('r2')], pg_temp.legs('r2', '13:00', '14:00', '15:00')) $$,
  'Another vehicle is fine');
select throws_ok(
  format($$ select save_schedule_draft(%L, %s, null, 'V1', array[pg_temp.id('r2')], pg_temp.legs('r2', '13:00', '14:00', '15:00')) $$,
    pg_temp.id('s2'), pg_temp.rv(pg_temp.id('s2'))),
  '23P01', null, 'Switching another schedule to V1 is refused too');
select lives_ok(
  format($$ select save_schedule_draft(%L, %s, null, 'V1', array[pg_temp.id('r1')], pg_temp.legs('r1', '08:30', '09:30', '10:30')) $$,
    pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))),
  'A schedule keeps its own vehicle when saved again');

select discard_schedule_draft(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
select lives_ok(
  format($$ select save_schedule_draft(%L, %s, null, 'V1', array[pg_temp.id('r2')], pg_temp.legs('r2', '13:00', '14:00', '15:00')) $$,
    pg_temp.id('s2'), pg_temp.rv(pg_temp.id('s2'))),
  'Discarding the first schedule frees V1 for the day');
select is((select plate from schedule_revisions where schedule_id = pg_temp.id('s2') and status = 'DRAFT'), 'V1',
  'The other schedule now has V1');

select lives_ok(
  format($$ select submit_schedule(%L, %s) $$, pg_temp.id('s2'), pg_temp.rv(pg_temp.id('s2'))),
  'and it keeps V1 when submitted');

select * from finish();
rollback;

-- v2.2: the Planner's request-pool redesign — a non-final leg with no
-- request stops needs an Admin-flagged "other stop" destination, and a
-- leg's planned times may be left blank while saving a draft but not while
-- submitting it (0033_planner_request_pool.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000001a', 'juan2@test.local'),
  ('00000000-0000-0000-0000-00000000001d', 'sched2@test.local'),
  ('00000000-0000-0000-0000-00000000001e', 'driver3@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000001a', 'juan2', 'Juan Two', 'Requester'),
  ('00000000-0000-0000-0000-00000000001d', 'sched2', 'Sam Two', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000001e', 'driver3', 'Dee Three', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V9', 'Van 9', '00000000-0000-0000-0000-00000000001e');
insert into booking_options ("group", id, name, status, is_other_stop) values
  ('destinations', 'd9', 'City Hall 2', 'Active', false),
  ('destinations', 'shell9', 'Shell Station', 'Active', true),
  ('purposes', 'p9', 'Inspection', 'Active', false);

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date + 10;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000001a');
select create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d9","purposeId":"p9"}]', null);
reset role;

create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
insert into ids select 'juan', id from requests where owner_account_id = '00000000-0000-0000-0000-00000000001a';
insert into ids select 'juan_rd', (select id from request_destinations where request_id = v and active) from ids where k = 'juan';
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
-- The schedule this test builds up over several saves, and its live
-- row_version (like v2_schedules.test.sql's pg_temp.rv()).
create function pg_temp.rv() returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = pg_temp.id('sched') and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;

-- Leg builders, mirroring lib/trip-record.ts's toScheduleInput shape -------
create function pg_temp.other_stop_leg() returns jsonb language sql as $$
  select jsonb_build_object('destinationId', 'shell9', 'plannedTimeOut', '08:00', 'plannedTimeIn', '08:15', 'stops', '[]'::jsonb);
$$;
create function pg_temp.stopless_leg() returns jsonb language sql as $$
  select jsonb_build_object('destinationId', 'd9', 'plannedTimeOut', '08:00', 'plannedTimeIn', '08:15', 'stops', '[]'::jsonb);
$$;
create function pg_temp.timed_juan_leg() returns jsonb language sql as $$
  select jsonb_build_object('destinationId', 'd9', 'plannedTimeOut', '08:30', 'plannedTimeIn', '09:00',
    'stops', jsonb_build_array(pg_temp.id('juan_rd')));
$$;
create function pg_temp.untimed_juan_leg() returns jsonb language sql as $$
  select jsonb_build_object('destinationId', 'd9', 'plannedTimeOut', '', 'plannedTimeIn', '',
    'stops', jsonb_build_array(pg_temp.id('juan_rd')));
$$;
create function pg_temp.final_leg(p_out text, p_in text) returns jsonb language sql as $$
  select jsonb_build_object('isFinal', true, 'plannedTimeOut', p_out, 'plannedTimeIn', p_in);
$$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000001d');

-- A non-final leg with no request stops needs an other-stop destination.
-- This attempt is rejected and rolled back, so it creates no schedule.
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V9', array[pg_temp.id('juan')],
       jsonb_build_array(pg_temp.stopless_leg(), pg_temp.final_leg('09:30', '10:30'))) $$,
  '22023', 'Leg 1: a destination with no request needs to be marked as an other stop',
  'A stop-less leg on an ordinary destination is rejected');

-- The same shape is fine once the destination is flagged is_other_stop.
select lives_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V9', array[pg_temp.id('juan')],
       jsonb_build_array(pg_temp.other_stop_leg(), pg_temp.timed_juan_leg(), pg_temp.final_leg('09:30', '10:30'))) $$,
  'A stop-less other-stop leg is accepted alongside a request-linked leg');
insert into ids select 'sched', id from schedules where created_by_account_id = '00000000-0000-0000-0000-00000000001d';

select isnt_empty(
  $$ select 1 from schedule_reservations
     where revision_id = (select id from schedule_revisions where schedule_id = pg_temp.id('sched') and status = 'DRAFT') $$,
  'A fully timed draft reserves its time window');

-- Times are optional to save a draft, required to submit.
select lives_ok(
  format(
    $$ select save_schedule_draft(%L::uuid, %s, pg_temp.d(), 'V9', array[pg_temp.id('juan')],
         jsonb_build_array(pg_temp.untimed_juan_leg(), pg_temp.final_leg('', ''))) $$,
    pg_temp.id('sched'), pg_temp.rv()
  ),
  'A draft with no leg times at all saves successfully');

select is_empty(
  $$ select 1 from schedule_reservations
     where revision_id = (select id from schedule_revisions where schedule_id = pg_temp.id('sched') and status = 'DRAFT') $$,
  'An untimed draft holds no time reservation');

select throws_ok(
  format($$ select submit_schedule(%L::uuid, %s) $$, pg_temp.id('sched'), pg_temp.rv()),
  '22023', 'Enter planned Time Out and Time In for every leg',
  'Submitting without times is refused, even though saving the draft worked');

-- Filling the times back in lets the same draft be submitted later.
select lives_ok(
  format(
    $$ select save_schedule_draft(%L::uuid, %s, pg_temp.d(), 'V9', array[pg_temp.id('juan')],
         jsonb_build_array(pg_temp.timed_juan_leg(), pg_temp.final_leg('09:30', '10:30'))) $$,
    pg_temp.id('sched'), pg_temp.rv()
  ),
  'Filling in every leg''s times updates the same draft');

select * from finish();
rollback;

-- Trip attendance: record_trip_attendance (Start / End taps), who may tap,
-- ordering and date rules, distance from ANONANG, repeats, Admin override
-- and who can read the rows.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- These tests are about scheduling, not the vehicle a request names
-- (v2_request_vehicle.test.sql), so any vehicle may take any request here.
alter table revision_requests disable trigger revision_requests_request_vehicle;

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

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into ids select 'past', id from create_request(pg_temp.manila_today() - 1, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', 'V1');
insert into ids select 'past2', id from create_request(pg_temp.manila_today() - 1, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', 'V1');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into ids select 'future', id from create_request(pg_temp.manila_today() + 10, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', 'V1');
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
-- sp: Dan (V1), yesterday. sf: Dee (V2), in 10 days. sp2: Dot (V3), yesterday.
insert into ids values ('sp', pg_temp.publish('V1', pg_temp.manila_today() - 1, 'past'));
insert into ids values ('sf', pg_temp.publish('V2', pg_temp.manila_today() + 10, 'future'));
insert into ids values ('sp2', pg_temp.publish('V3', pg_temp.manila_today() - 1, 'past2'));

-- Distance from ANONANG --------------------------------------------------------
select is(distance_from_base_m(16.103769, 120.436222), 0::double precision, 'ANONANG itself is 0 m from base');
select ok(distance_from_base_m(16.112769, 120.436222) between 990 and 1010, 'About 0.009 degrees north is about 1 km');
select is(distance_from_base_m(null, null), null, 'No position, no distance');

-- Who may tap ------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select record_trip_attendance(pg_temp.id('sp'), 'START') $$, '42501', null, 'Scheduler cannot start a trip');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select record_trip_attendance(pg_temp.id('sp'), 'START') $$, '42501', null, 'Requester cannot start a trip');
select pg_temp.act_as('00000000-0000-0000-0000-000000000010');
select throws_ok($$ select record_trip_attendance(pg_temp.id('sp'), 'START') $$, 'P0002', null, 'Another Driver cannot start it');
select throws_ok($$ select record_trip_attendance(gen_random_uuid(), 'START') $$, 'P0002', null, 'Unknown schedule is not found');

-- Validation and ordering --------------------------------------------------------
select throws_ok($$ select record_trip_attendance(pg_temp.id('sf'), 'START') $$, '22023', null,
  'A trip can''t be started before its date');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select record_trip_attendance(pg_temp.id('sp'), 'END') $$, '22023', null, 'End before Start is refused');
select throws_ok($$ select record_trip_attendance(pg_temp.id('sp'), 'PAUSE') $$, '22023', null, 'An unknown tap is refused');
select throws_ok($$ select record_trip_attendance(pg_temp.id('sp'), 'START', 16.1, null) $$, '22023', null,
  'Half a position is refused');
select throws_ok($$ select record_trip_attendance(pg_temp.id('sp'), 'START', 95, 120) $$, '22023', null,
  'A latitude past 90 is refused');

-- Start and End ----------------------------------------------------------------
select lives_ok($$ select record_trip_attendance(pg_temp.id('sp'), 'START', 16.103769, 120.436222, 12, '  Mabato, Anonang, Pangasinan ') $$,
  'The Driver starts a trip at ANONANG');
select is((select start_distance_m from trip_attendance where schedule_id = pg_temp.id('sp')), 0::double precision,
  'Start is 0 m from base');
select is((select start_accuracy_m from trip_attendance where schedule_id = pg_temp.id('sp')), 12::double precision,
  'The accuracy is kept');
select is((select start_address from trip_attendance where schedule_id = pg_temp.id('sp')), 'Mabato, Anonang, Pangasinan',
  'The address is kept, trimmed');
select is((select revision_id from trip_attendance where schedule_id = pg_temp.id('sp')),
  (select published_revision_id from schedules where id = pg_temp.id('sp')), 'It pins the approved version');
select is((select start_lat from record_trip_attendance(pg_temp.id('sp'), 'START', 10, 10)), 16.103769::double precision,
  'Repeating Start keeps the first tap');
select lives_ok($$ select record_trip_attendance(pg_temp.id('sp'), 'END', 16.112769, 120.436222, 30) $$,
  'The Driver ends the trip away from base');
select ok((select end_distance_m > 150 from trip_attendance where schedule_id = pg_temp.id('sp')),
  'End is recorded with its distance (over 150 m, so it shows as flagged)');
select is((select end_lat from record_trip_attendance(pg_temp.id('sp'), 'END', 16.103769, 120.436222)), 16.112769::double precision,
  'Repeating End keeps the first tap');

-- Admin acting as Driver, without a position -------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select record_trip_attendance(pg_temp.id('sp2'), 'START', null, null, null, 'Somewhere') $$, 'Admin starts another Driver''s trip');
select is((select driver_id from trip_attendance where schedule_id = pg_temp.id('sp2')),
  '00000000-0000-0000-0000-000000000011'::uuid, 'The row still belongs to the assigned Driver');
select is((select start_recorded_by_account_id from trip_attendance where schedule_id = pg_temp.id('sp2')),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'It records that Admin tapped');
select is((select start_distance_m from trip_attendance where schedule_id = pg_temp.id('sp2')), null,
  'No position means no distance');
select is((select start_address from trip_attendance where schedule_id = pg_temp.id('sp2')), null,
  'No position means no address, whatever is sent');
select ok(
  (select is_admin_override from audit_events
   where action = 'attendance.start' and record_id = (select id from trip_attendance where schedule_id = pg_temp.id('sp2'))),
  'The Admin tap is audited with is_admin_override');

-- Who can read -----------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select is((select count(*)::int from trip_attendance where schedule_id in (pg_temp.id('sp'), pg_temp.id('sp2'))), 1,
  'A Driver sees only their own attendance');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from trip_attendance where schedule_id in (pg_temp.id('sp'), pg_temp.id('sp2'))), 0,
  'A Scheduler sees no attendance');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from trip_attendance where schedule_id in (pg_temp.id('sp'), pg_temp.id('sp2'))), 2,
  'Admin sees every Driver''s attendance');

select * from finish();
rollback;

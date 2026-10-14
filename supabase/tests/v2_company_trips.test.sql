-- Company trips: the requester's vehicle and Driver, one department and
-- starting point per trip, several trips a day without overlaps, no leg
-- back to ANONANG (0054_company_trips.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000fa', 'rhea2@test.local'),
  ('00000000-0000-0000-0000-0000000000fb', 'sam2@test.local'),
  ('00000000-0000-0000-0000-0000000000f1', 'jun2@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'mark2@test.local');
insert into accounts (id, username, name, role, position, can_request_company) values
  ('00000000-0000-0000-0000-0000000000fa', 'rhea2', 'Rhea Santos', 'Requester', 'Purchasing Officer', true);
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000000fb', 'sam2', 'Sam D', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000000f2', 'mark2', 'Mark Dizon', 'Driver');
insert into accounts (id, username, name, role, driver_type) values
  ('00000000-0000-0000-0000-0000000000f1', 'jun2', 'Jun Reyes', 'Driver', 'Company car');
insert into vehicles (plate, name, company_trips, assigned_driver_id) values
  ('CM', 'Mirage', true, null),
  ('CH', 'Hilux', false, '00000000-0000-0000-0000-0000000000f2');
insert into booking_options ("group", id, name, status) values
  ('projects', 'cp', 'Head office', 'Active'),
  ('destinations', 'cd1', 'BIR RDO 43', 'Active'),
  ('destinations', 'cd2', 'BDO Ortigas', 'Active'),
  ('purposes', 'cpu', 'Submission', 'Active'),
  ('departments', 'cdep1', 'Accounting', 'Active'),
  ('departments', 'cdep2', 'Procurement', 'Active'),
  ('starting_points', 'csp', 'Main Office', 'Active'),
  ('supervisors', 'csup', 'Engr. Dante Villanueva', 'Active'),
  ('heads', 'ch', 'Engr. Carmela Ong', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date + 10;
$$;
create function pg_temp.stop(p_dest text) returns jsonb language sql as $$
  select jsonb_build_object('projectId', 'cp', 'destinationId', p_dest, 'purposeId', 'cpu', 'flexibility', 'DAY');
$$;
create function pg_temp.company(p_dept text, p_stops jsonb) returns jsonb language sql as $$
  select jsonb_build_object('date', pg_temp.d(), 'startingPointId', 'csp', 'departmentId', p_dept, 'vehiclePlate', 'CM',
    'driverId', '00000000-0000-0000-0000-0000000000f1', 'supervisorId', 'csup', 'headId', 'ch', 'stops', p_stops);
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
-- One leg per stop, in order, with the given times.
create function pg_temp.legs(p_stops uuid[], p_times text[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'destinationId', rd.destination_id, 'plannedTimeOut', p_times[2 * n - 1], 'plannedTimeIn', p_times[2 * n],
    'stops', jsonb_build_array(rd.id)) order by n)
  from unnest(p_stops) with ordinality as s (request_id, n)
  join request_destinations rd on rd.request_id = s.request_id and rd.active;
$$;

-- Rhea asks for two Accounting stops and one Procurement stop; Mark's truck has a Daily request.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000fa');
insert into ids select 'g1', (create_request_group('COMPANY', pg_temp.company('cdep1', jsonb_build_array(pg_temp.stop('cd1'), pg_temp.stop('cd2'))))).id;
insert into ids select 'g2', (create_request_group('COMPANY', pg_temp.company('cdep2', jsonb_build_array(pg_temp.stop('cd1'))))).id;
insert into ids select 'gd', (create_request_group('DAILY', jsonb_build_object('date', pg_temp.d(), 'stops', jsonb_build_array(pg_temp.stop('cd1'))))).id;
reset role;
insert into ids select 'a', id from requests where group_id = pg_temp.id('g1') and stop_letter = 'A';
insert into ids select 'b', id from requests where group_id = pg_temp.id('g1') and stop_letter = 'B';
insert into ids select 'p', id from requests where group_id = pg_temp.id('g2');
insert into ids select 'daily', id from requests where group_id = pg_temp.id('gd');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000fb');

-- Planning a Company trip --------------------------------------------------
select lives_ok(
  format('select create_company_trip(%L, %L, %L, %L)', pg_temp.d(), 'CM', array[pg_temp.id('a'), pg_temp.id('b')],
    pg_temp.legs(array[pg_temp.id('a'), pg_temp.id('b')], array['08:00', '08:45', '09:30', '10:00'])),
  'A Scheduler plans both Accounting stops as one trip on the Mirage, with no leg back to ANONANG');
reset role;
insert into ids select 't1', s.id from schedules s join schedule_revisions r on r.schedule_id = s.id
  join revision_requests rr on rr.revision_id = r.id where rr.request_id = pg_temp.id('a');
select is((select kind from schedules where id = pg_temp.id('t1')), 'COMPANY', 'It is a Company trip');
select is((select origin from schedule_legs l join schedule_revisions r on r.id = l.revision_id
  where r.schedule_id = pg_temp.id('t1') and l.leg_no = 1), 'Main Office', 'Leg 1 starts at the starting point');
select is((select driver_name from schedule_revisions where schedule_id = pg_temp.id('t1')), 'Jun Reyes',
  'Its Driver is the one Rhea picked, not the vehicle''s');
select lives_ok(
  format('select submit_schedule(%L, %s)', pg_temp.id('t1'),
    (select row_version from schedule_revisions where schedule_id = pg_temp.id('t1'))),
  'It can be submitted without a leg back to ANONANG');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000fb');
select throws_ok(
  format('select create_company_trip(%L, %L, %L, %L)', pg_temp.d(), 'CM', array[pg_temp.id('p')],
    pg_temp.legs(array[pg_temp.id('p')], array['09:00', '11:00'])),
  '23P01', 'This vehicle or Driver is already reserved for part of that time', 'A second trip that overlaps is refused');
select throws_ok(
  format('select create_company_trip(%L, %L, %L, %L)', pg_temp.d(), 'CM', array[pg_temp.id('p')],
    pg_temp.legs(array[pg_temp.id('p')], array['15:00', '16:00']) || '[{"isFinal": true, "plannedTimeOut": "16:00", "plannedTimeIn": "17:00"}]'::jsonb),
  '22023', 'A Company Trip ends at its last destination; it has no leg back to ANONANG', 'A leg back to ANONANG is refused');
select lives_ok(
  format('select create_company_trip(%L, %L, %L, %L)', pg_temp.d(), 'CM', array[pg_temp.id('p')],
    pg_temp.legs(array[pg_temp.id('p')], array['13:00', '14:00'])),
  'A second trip on the same vehicle later that day is fine');

-- What a trip may take ------------------------------------------------------
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000fa');
insert into ids select 'g3', (create_request_group('COMPANY', pg_temp.company('cdep2', jsonb_build_array(pg_temp.stop('cd2'))))).id;
reset role;
insert into ids select 'q', id from requests where group_id = pg_temp.id('g3');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000fa');
insert into ids select 'g5', (create_request_group('COMPANY', pg_temp.company('cdep1', jsonb_build_array(pg_temp.stop('cd2'))))).id;
reset role;
insert into ids select 'r', id from requests where group_id = pg_temp.id('g5');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000fb');
select throws_ok(
  format('select create_company_trip(%L, %L, %L, %L)', pg_temp.d(), 'CM', array[pg_temp.id('q'), pg_temp.id('r')],
    pg_temp.legs(array[pg_temp.id('q'), pg_temp.id('r')], array['17:00', '17:30', '17:40', '18:00'])),
  '22023', null, 'A trip is for one department');
select throws_ok(
  format('select create_company_trip(%L, %L, %L, %L)', pg_temp.d(), 'CM', array[pg_temp.id('daily')],
    pg_temp.legs(array[pg_temp.id('daily')], array['17:00', '17:30'])),
  '22023', null, 'A Daily request can''t go on a Company trip');
select throws_ok(
  format('select save_schedule_draft(null, null, %L, %L, %L, %L)', pg_temp.d(), 'CM', array[pg_temp.id('daily')],
    pg_temp.legs(array[pg_temp.id('daily')], array['17:00', '17:30'])),
  '22023', 'CM can be requested for company trips, so it isn''t used for Daily trips', 'A Daily trip can''t use a company trip vehicle');
select throws_ok(
  format('select save_schedule_draft(null, null, %L, %L, %L, %L)', pg_temp.d(), 'CH', array[pg_temp.id('q')],
    pg_temp.legs(array[pg_temp.id('q')], array['17:00', '17:30'])),
  '22023', null, 'A Company Trip request can''t go on a Daily trip');
select lives_ok(
  format('select save_schedule_draft(null, null, %L, %L, %L, %L)', pg_temp.d(), 'CH', array[pg_temp.id('daily')],
    pg_temp.legs(array[pg_temp.id('daily')], array['08:00', '09:00'])),
  'A Daily trip on the truck still works');

select * from finish();
rollback;

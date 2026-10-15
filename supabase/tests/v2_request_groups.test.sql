-- Request groups and stops: the new Daily and Company Trip forms
-- (0052_request_groups.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000da', 'rhea@test.local'),
  ('00000000-0000-0000-0000-0000000000db', 'liza@test.local'),
  ('00000000-0000-0000-0000-0000000000dd', 'schedd@test.local'),
  ('00000000-0000-0000-0000-0000000000d1', 'jun@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'mark@test.local');
insert into accounts (id, username, name, role, position, can_request_company) values
  ('00000000-0000-0000-0000-0000000000da', 'rhea', 'Rhea Santos', 'Requester', 'Purchasing Officer', true),
  ('00000000-0000-0000-0000-0000000000db', 'liza', 'Liza Mendoza', 'Requester', '', false);
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000000dd', 'schedd', 'Sam D', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000000d2', 'mark', 'Mark Dizon', 'Driver');
insert into accounts (id, username, name, role, driver_type) values
  ('00000000-0000-0000-0000-0000000000d1', 'jun', 'Jun Reyes', 'Driver', 'Company car');
insert into vehicles (plate, name, company_trips, assigned_driver_id) values
  ('VM', 'Mirage', true, null),
  ('VD', 'Hilux', false, '00000000-0000-0000-0000-0000000000d2');
insert into booking_options ("group", id, name, status) values
  ('projects', 'p1', 'Riverside Townhomes', 'Active'),
  ('projects', 'p2', 'Harbor View Mall', 'Active'),
  ('destinations', 'd1', 'Wilcon Depot', 'Active'),
  ('destinations', 'd2', 'Site A Warehouse', 'Active'),
  ('purposes', 'pu', 'Pick up', 'Active'),
  ('purposes', 'sv', 'Site visit', 'Active'),
  ('urgent_reasons', 'ur1', 'Critical materials delivery', 'Active'),
  ('departments', 'dep1', 'Procurement – Main Office', 'Active'),
  ('starting_points', 'sp1', 'Main Office', 'Active'),
  ('suppliers', 'su1', 'Wilcon Depot – Mandaue', 'Active'),
  ('supervisors', 'sup1', 'Engr. Dante Villanueva', 'Active'),
  ('heads', 'h1', 'Engr. Carmela Ong', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d(p_days int default 10) returns text language sql as $$
  select ((now() at time zone 'Asia/Manila')::date + p_days)::text;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
-- A regular stop, with overrides.
create function pg_temp.stop(p_over jsonb default '{}') returns jsonb language sql as $$
  select '{"projectId":"p1","destinationId":"d2","purposeId":"sv","flexibility":"DAY"}'::jsonb || p_over;
$$;
create function pg_temp.daily(p_stops jsonb, p_days int default 10) returns jsonb language sql as $$
  select jsonb_build_object('date', pg_temp.d(p_days), 'stops', p_stops);
$$;
create function pg_temp.company(p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object(
    'date', pg_temp.d(), 'startingPointId', 'sp1', 'departmentId', 'dep1', 'vehiclePlate', 'VM',
    'driverId', '00000000-0000-0000-0000-0000000000d1', 'supervisorId', 'sup1', 'headId', 'h1',
    'stops', jsonb_build_array(pg_temp.stop('{"destinationId":"d1","purposeId":"pu","details":"Rebar samples","supplierId":"su1"}'))
  ) || p_over;
$$;

-- Daily Vehicle Trip ---------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000da');
select lives_ok(
  $$ insert into ids select 'g1', id from create_request_group('DAILY', pg_temp.daily(jsonb_build_array(
       pg_temp.stop(),
       pg_temp.stop('{"destinationId":"d1","urgentReasonId":"ur1","details":"40 bags cement, PO 2231","flexibility":"FIXED","fixedTime":"08:30"}')))) $$,
  'A Daily request with a regular and an urgent stop');
reset role;
select is((select string_agg(stop_letter, ',' order by stop_letter) from requests where group_id = pg_temp.id('g1')), 'A,B',
  'Each stop is its own request, lettered A, B');
select is((select request_type from requests where group_id = pg_temp.id('g1') and stop_letter = 'B'), 'URGENT',
  'A stop with an urgent reason is Urgent');
select is((select purpose_name from request_destinations rd join requests r on r.id = rd.request_id
           where r.group_id = pg_temp.id('g1') and r.stop_letter = 'B'), 'Critical materials delivery',
  'and its reason takes the purpose''s place');
select is((select fixed_time::text from requests where group_id = pg_temp.id('g1') and stop_letter = 'B'), '08:30:00',
  'A fixed-time stop keeps its time');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000da');
select throws_ok(
  $$ select create_request_group('DAILY', pg_temp.daily(jsonb_build_array(pg_temp.stop('{"destinationId":"d1","purposeId":"pu"}')))) $$,
  '22023', 'Stop A: add the details, e.g. what to pick up or deliver', 'A Pick up stop needs details');
select throws_ok(
  $$ select create_request_group('DAILY', pg_temp.daily(jsonb_build_array(pg_temp.stop('{"urgentReasonId":"ur1"}')))) $$,
  '22023', 'Stop A: add the details, e.g. what to pick up or deliver', 'An urgent stop needs details');
select throws_ok(
  $$ select create_request_group('DAILY', pg_temp.daily(jsonb_build_array(pg_temp.stop('{"flexibility":"FIXED"}')))) $$,
  '22023', 'Stop A: add the appointment time', 'A fixed-time stop needs its time');
select throws_ok(
  $$ select create_request_group('DAILY', pg_temp.daily(jsonb_build_array(pg_temp.stop('{"projectId":""}')))) $$,
  '22023', 'Stop A: Project / Site is required', 'Every stop needs a Project / Site');
select throws_ok(
  $$ select create_request_group('DAILY', pg_temp.daily(jsonb_build_array(pg_temp.stop()), -1)) $$,
  '22023', 'That date has passed. Choose today or a later date', 'A past date is refused');
select lives_ok(
  $$ select create_request_group('DAILY', pg_temp.daily(jsonb_build_array(pg_temp.stop()), 2)) $$,
  'Two days ahead is fine: the date no longer sets Regular or Urgent');

-- Company Trip --------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000db');
select throws_ok($$ select create_request_group('COMPANY', pg_temp.company()) $$, '42501', 'Not authorized to create requests',
  'Only accounts an Admin allows can request company trips');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000da');
select throws_ok($$ select create_request_group('COMPANY', pg_temp.company('{"vehiclePlate":""}')) $$, '22023', 'Select a vehicle',
  'A Company Trip needs a vehicle');
select throws_ok($$ select create_request_group('COMPANY', pg_temp.company('{"vehiclePlate":"VD"}')) $$, '22023',
  'This vehicle can''t be requested for company trips', 'and one that can be requested for company trips');
select throws_ok(
  $$ select create_request_group('COMPANY', pg_temp.company('{"driverId":"00000000-0000-0000-0000-0000000000d2"}')) $$,
  '22023', 'Select an active Company car driver', 'A Truck driver cannot be picked');
select throws_ok($$ select create_request_group('COMPANY', pg_temp.company('{"headId":""}')) $$, '22023',
  'Project Manager / Construction Manager / Dept. Head is required', 'The PM / CM / Dept. Head is required');
select throws_ok(
  $$ select create_request_group('COMPANY', pg_temp.company(jsonb_build_object('stops', jsonb_build_array(
       pg_temp.stop('{"destinationId":"","destinationOther":"Somewhere new"}'))))) $$,
  '22023', 'Stop A: choose the destination from the list', 'A Company Trip has no typed destinations');
select throws_ok(
  $$ select create_request_group('COMPANY', pg_temp.company(jsonb_build_object('stops', jsonb_build_array(
       pg_temp.stop('{"destinationId":"d1"}'), pg_temp.stop('{"projectId":"p2"}'))))) $$,
  '22023', 'A company trip is for one Project / Site. Pick the same one for every stop',
  'A Company Trip''s stops share one Project / Site (0058)');
select lives_ok($$ insert into ids select 'g2', id from create_request_group('COMPANY', pg_temp.company()) $$,
  'A complete Company Trip');
reset role;
select is((select vehicle_plate || ' / ' || supplier_name from requests where group_id = pg_temp.id('g2')),
  'VM / Wilcon Depot – Mandaue', 'Its stops carry the chosen vehicle and their supplier');
select is((select driver_name from request_groups where id = pg_temp.id('g2')), 'Jun Reyes', 'and the group the chosen Driver');
select is((select department_id || ' / ' || department_name from request_groups where id = pg_temp.id('g2')),
  'p1 / Riverside Townhomes', 'Its Department / Site is its Project / Site (0058)');

-- Editing -------------------------------------------------------------------
insert into ids select 'a', id from requests where group_id = pg_temp.id('g1') and stop_letter = 'A';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000da');
select throws_ok(
  $$ select update_request_group(pg_temp.id('g1'), 99, pg_temp.daily('[]')) $$,
  'PT409', 'This request was changed elsewhere. Reload it and try again', 'A stale edit is refused');
select lives_ok(
  $$ select update_request_group(pg_temp.id('g1'), 1, pg_temp.daily(jsonb_build_array(
       pg_temp.stop(jsonb_build_object('id', pg_temp.id('a'), 'details', 'Check the gate')),
       pg_temp.stop('{"destinationId":"d1"}')))) $$,
  'An edit changes stop A, drops B and adds a new stop');
reset role;
select is((select string_agg(stop_letter || ':' || status, ',' order by stop_letter) from requests where group_id = pg_temp.id('g1')),
  'A:ACTIVE,B:CANCELLED,C:ACTIVE', 'B is cancelled and the new stop is C');

-- A new date makes a sent-back stop a fresh request again
update requests set sent_back_at = now(), sent_back_by_account_id = '00000000-0000-0000-0000-0000000000dd', sent_back_reason = 'No room that day'
where group_id = pg_temp.id('g1') and stop_letter = 'C';
insert into ids select 'c', id from requests where group_id = pg_temp.id('g1') and stop_letter = 'C';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000da');
select update_request_group(pg_temp.id('g1'), 2, pg_temp.daily(jsonb_build_array(
  jsonb_build_object('id', pg_temp.id('a')) || pg_temp.stop(), jsonb_build_object('id', pg_temp.id('c')) || pg_temp.stop()), 12));
reset role;
select ok((select sent_back_at is null and sent_back_reason = '' from requests where id = pg_temp.id('c')),
  'Moving the request to another day clears a sent-back stop');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000da');
select update_request_group(pg_temp.id('g1'), 3, pg_temp.daily(jsonb_build_array(
  jsonb_build_object('id', pg_temp.id('a')) || pg_temp.stop(), jsonb_build_object('id', pg_temp.id('c')) || pg_temp.stop())));
reset role;

-- Once a stop is scheduled, it and the date stay
select pg_temp.act_as('00000000-0000-0000-0000-0000000000dd');
select save_schedule_draft(null, null, pg_temp.d()::date, 'VD', array[pg_temp.id('a')], jsonb_build_array(
  jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
    'stops', (select jsonb_agg(id) from request_destinations where request_id = pg_temp.id('a') and active)),
  jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30')));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000da');
select throws_ok(
  $$ select update_request_group(pg_temp.id('g1'), 4, pg_temp.daily(jsonb_build_array(
       jsonb_build_object('id', pg_temp.id('a'))), 11)) $$,
  '22023', 'Part of this request is already being scheduled, so its date and trip details can no longer be changed',
  'The date is locked while a stop is scheduled');
select throws_ok(
  $$ select update_request_group(pg_temp.id('g1'), 4, pg_temp.daily('[]')) $$,
  '22023', 'Stop A is already being scheduled. Ask for its cancellation instead', 'A scheduled stop cannot be dropped');

-- Who sees a group ----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000db');
select is((select count(*)::int from request_groups where id = pg_temp.id('g1')), 0, 'Another requester cannot see it');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from request_groups where id = pg_temp.id('g2')), 1, 'The Company Trip''s Driver can');

select * from finish();
rollback;

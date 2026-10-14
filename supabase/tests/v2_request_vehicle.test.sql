-- The Requester chooses the vehicle on the request; a schedule takes only
-- requests for its own vehicle (0050_request_vehicle.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ca', 'juanc@test.local'),
  ('00000000-0000-0000-0000-0000000000cb', 'adminc@test.local'),
  ('00000000-0000-0000-0000-0000000000cd', 'schedc@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'driverc1@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'driverc2@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'driverc3@test.local'),
  ('00000000-0000-0000-0000-0000000000c4', 'driverc4@test.local'),
  ('00000000-0000-0000-0000-0000000000c5', 'driverc5@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000000ca', 'juanc', 'Juan C', 'Requester'),
  ('00000000-0000-0000-0000-0000000000cb', 'adminc', 'Ada C', 'Admin'),
  ('00000000-0000-0000-0000-0000000000cd', 'schedc', 'Sam C', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000000c1', 'driverc1', 'Dee One', 'Driver'),
  ('00000000-0000-0000-0000-0000000000c2', 'driverc2', 'Dee Two', 'Driver'),
  ('00000000-0000-0000-0000-0000000000c3', 'driverc3', 'Dee Three', 'Driver'),
  ('00000000-0000-0000-0000-0000000000c4', 'driverc4', 'Dee Truck', 'Driver'),
  ('00000000-0000-0000-0000-0000000000c5', 'driverc5', 'Dee Five', 'Driver');
insert into vehicles (plate, name, status, assigned_driver_id) values
  ('VA', 'Van A', 'Active', '00000000-0000-0000-0000-0000000000c1'),
  ('VB', 'Van B', 'Active', '00000000-0000-0000-0000-0000000000c2'),
  ('VC', 'Van C', 'Active', '00000000-0000-0000-0000-0000000000c3'),
  ('VN', 'Van N', 'Active', null),
  ('VI', 'Van I', 'Inactive', null);
insert into vehicles (plate, name, vehicle_type, requestable, assigned_driver_id) values
  ('VT', 'Truck T', 'Truck', true, '00000000-0000-0000-0000-0000000000c4'),
  ('VR', 'Van R', 'Van', false, '00000000-0000-0000-0000-0000000000c5');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'dc', 'City Hall C', 'Active'),
  ('purposes', 'pc', 'Inspection', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date + 10;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.rv(p_k text) returns int language sql as $$
  select row_version from requests where id = pg_temp.id(p_k);
$$;
create function pg_temp.plate(p_k text) returns text language sql as $$
  select vehicle_plate from requests where id = pg_temp.id(p_k);
$$;
create function pg_temp.legs(p_k text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('destinationId', 'dc', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
      'stops', (select jsonb_agg(id) from request_destinations where request_id = pg_temp.id(p_k) and active)),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30'));
$$;
create function pg_temp.edit(p_k text, p_plate text) returns requests language sql as $$
  select update_request(pg_temp.id(p_k), pg_temp.rv(p_k), pg_temp.d(), 'REGULAR', null, null,
    '[{"destinationId":"dc","purposeId":"pc"}]', p_plate);
$$;

-- Choosing the vehicle -----------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
select throws_ok(
  $$ select create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', null) $$,
  '22023', 'Select a vehicle',
  'A request needs a vehicle');
select throws_ok(
  $$ select create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', 'VI') $$,
  '22023', 'Select an active vehicle',
  'An inactive vehicle cannot be chosen');
select throws_ok(
  $$ select create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', 'VN') $$,
  '22023', 'This vehicle has no Driver assigned',
  'A vehicle with no Driver cannot be chosen');
select lives_ok(
  $$ insert into ids select 'r1', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', 'VA') $$,
  'The Requester creates a request for Van A');
select is(pg_temp.plate('r1'), 'VA', 'The request keeps the chosen vehicle');
select lives_ok($$ select pg_temp.edit('r1', 'VB') $$, 'The Requester changes the vehicle while editing');
select is(pg_temp.plate('r1'), 'VB', 'The request now names Van B');

-- The Scheduler plans on the chosen vehicle --------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000cd');
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'VA', array[pg_temp.id('r1')], pg_temp.legs('r1')) $$,
  '22023', 'A selected request is for VB, not VA. Remove it from this trip',
  'A request cannot go on a vehicle its requester did not choose');
select lives_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'VB', array[pg_temp.id('r1')], pg_temp.legs('r1')) $$,
  'The request goes on its own vehicle');

-- A request from before vehicles were chosen may go on any vehicle
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
insert into ids select 'old', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', 'VC');
reset role;
update requests set vehicle_plate = null where id = pg_temp.id('old');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000cd');
select lives_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'VA', array[pg_temp.id('old')], pg_temp.legs('old')) $$,
  'A request with no vehicle may go on any vehicle');

-- Sent back, then a new vehicle: back in the pool --------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
insert into ids select 'r2', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', 'VA');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000cd');
select send_back_requests(array[pg_temp.id('r2')], 'Van A is already out that day');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
select pg_temp.edit('r2', 'VC');
select is((select sent_back_at from requests where id = pg_temp.id('r2')), null,
  'Choosing another vehicle returns a sent-back request to the pool');

-- Renaming a vehicle carries its requests ----------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000cb');
select rename_vehicle('VC', 'VZ', 'Van C', 'Active', '00000000-0000-0000-0000-0000000000c3');
select is(pg_temp.plate('r2'), 'VZ', 'A renamed plate follows onto the request');

-- An unchanged vehicle is kept even after it becomes Inactive ---------------
reset role;
update vehicles set status = 'Inactive' where plate = 'VZ';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
select lives_ok($$ select pg_temp.edit('r2', 'VZ') $$, 'Editing a request keeps its now-inactive vehicle');
select throws_ok($$ select pg_temp.edit('r2', 'VI') $$, '22023', 'Select an active vehicle',
  'Switching to an inactive vehicle is refused');

-- A split-off part keeps the vehicle ---------------------------------------
reset role;
insert into booking_options ("group", id, name, status) values ('destinations', 'dc2', 'Port C', 'Active');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
insert into ids select 'r3', id from create_request(pg_temp.d(), 'REGULAR', null, null,
  '[{"destinationId":"dc","purposeId":"pc"},{"destinationId":"dc2","purposeId":"pc"}]', 'VB');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000cd');
select lives_ok(
  $$ insert into ids select 'r3b', id from split_request(pg_temp.id('r3'),
       array(select id from request_destinations where request_id = pg_temp.id('r3') and destination_id = 'dc2' and active)) $$,
  'The Scheduler splits a stop off');
select is(pg_temp.plate('r3b'), 'VB', 'The split-off request keeps the chosen vehicle');

-- Only vehicles that can be requested are offered (0051) -------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
select throws_ok(
  $$ select create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', 'VR') $$,
  '22023', 'This vehicle can''t be requested for company trips',
  'A vehicle with requests turned off cannot be chosen');
insert into ids select 'r5', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', 'VA');
reset role;
update vehicles set requestable = false where plate = 'VA';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
select lives_ok($$ select pg_temp.edit('r5', 'VA') $$, 'Editing a request keeps a vehicle whose requests were turned off since');
reset role;
update vehicles set requestable = true where plate = 'VA';

-- Drivers may ask for transport, unless they drive a Truck ------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  $$ insert into ids select 'drv', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', 'VB') $$,
  'A van Driver creates a request');
select lives_ok($$ select pg_temp.edit('drv', 'VA') $$, 'The Driver edits their own request');
select lives_ok($$ select cancel_request(pg_temp.id('drv')) $$, 'The Driver cancels their own request');
select is((select status from requests where id = pg_temp.id('drv')), 'CANCELLED', 'and it is cancelled');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c4');
select throws_ok(
  $$ select create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', 'VB') $$,
  '42501', 'Not authorized to create requests',
  'A truck Driver cannot create a request');

select * from finish();
rollback;

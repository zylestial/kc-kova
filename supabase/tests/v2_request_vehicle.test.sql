-- Company Trip setup: who may ask for which kind of trip, Driver types,
-- vehicles that can be requested for company trips, and a request's chosen
-- vehicle (0050_request_vehicle.sql, 0051_company_trip_setup.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ca', 'juanc@test.local'),
  ('00000000-0000-0000-0000-0000000000cb', 'adminc@test.local'),
  ('00000000-0000-0000-0000-0000000000cd', 'schedc@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'truckc@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'carc@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'carc3@test.local'),
  ('00000000-0000-0000-0000-0000000000c4', 'vanc@test.local'),
  ('00000000-0000-0000-0000-0000000000c5', 'flipc@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000000ca', 'juanc', 'Juan C', 'Requester'),
  ('00000000-0000-0000-0000-0000000000cb', 'adminc', 'Ada C', 'Admin'),
  ('00000000-0000-0000-0000-0000000000cd', 'schedc', 'Sam C', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000000c1', 'truckc', 'Tess Truck', 'Driver'),
  ('00000000-0000-0000-0000-0000000000c3', 'carc3', 'Cy Car', 'Driver'),
  ('00000000-0000-0000-0000-0000000000c4', 'vanc', 'Van Driver', 'Driver'),
  ('00000000-0000-0000-0000-0000000000c5', 'flipc', 'Flip Driver', 'Driver');
insert into accounts (id, username, name, role, driver_type, can_request_daily) values
  ('00000000-0000-0000-0000-0000000000c2', 'carc', 'Cora Car', 'Driver', 'Company car', true);
insert into vehicles (plate, name, status, company_trips, assigned_driver_id) values
  ('VA', 'Mirage A', 'Active', true, '00000000-0000-0000-0000-0000000000c3'),
  ('VC', 'Mirage C', 'Active', true, null),
  ('VI', 'Mirage I', 'Inactive', true, null),
  ('VS', 'Hilux S', 'Active', false, '00000000-0000-0000-0000-0000000000c4');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'dc', 'City Hall C', 'Active'),
  ('destinations', 'dc2', 'Port C', 'Active'),
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
create function pg_temp.make(p_plate text) returns requests language sql as $$
  select create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"dc","purposeId":"pc"}]', p_plate);
$$;
create function pg_temp.edit(p_k text, p_plate text) returns requests language sql as $$
  select update_request(pg_temp.id(p_k), pg_temp.rv(p_k), pg_temp.d(), 'REGULAR', null, null,
    '[{"destinationId":"dc","purposeId":"pc"}]', p_plate);
$$;

-- Accounts: Driver type and the request switches ----------------------------
select is((select driver_type from accounts where username = 'truckc'), 'Truck', 'A new Driver starts as a Truck driver');
select throws_ok(
  $$ update accounts set can_request_daily = true where username = 'truckc' $$,
  '23514', null, 'A Truck driver can never be allowed to make requests');
select throws_ok(
  $$ update accounts set can_request_company = true where username = 'juanc' $$,
  '23514', null, 'Company trips need a Position on the account');
select lives_ok(
  $$ update accounts set can_request_company = true, position = 'Purchasing Officer' where username = 'juanc' $$,
  'With a Position, an Admin allows company trips');
update accounts set role = 'Requester' where username = 'flipc';
select is((select driver_type from accounts where username = 'flipc'), null, 'Someone who stops being a Driver loses the Driver type');

select ok((select can_request_company(a) from accounts a where username = 'juanc'), 'A Requester with the switch can request company trips');
select ok(not (select can_request_company(a) from accounts a where username = 'adminc'), 'An Admin without the switch cannot');

-- Drivers ask only when allowed ---------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select pg_temp.make(null) $$, '42501', 'Not authorized to create requests', 'A Truck driver cannot make requests');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ select pg_temp.make(null) $$, '42501', 'Not authorized to create requests', 'A Company car driver who is not allowed cannot');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
select lives_ok(
  $$ insert into ids select 'drv', id from pg_temp.make(null) $$,
  'A Company car driver allowed Daily requests makes one');
select lives_ok($$ select cancel_request(pg_temp.id('drv')) $$, 'and can cancel it');

-- Choosing a vehicle --------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
select lives_ok($$ insert into ids select 'daily', id from pg_temp.make(null) $$, 'A Daily request names no vehicle');
select throws_ok($$ select pg_temp.make('VS') $$, '22023', 'This vehicle can''t be requested for company trips',
  'A vehicle that can''t be requested for company trips is refused');
select throws_ok($$ select pg_temp.make('VI') $$, '22023', 'Select an active vehicle', 'An inactive vehicle is refused');
select lives_ok($$ insert into ids select 'r1', id from pg_temp.make('VA') $$, 'A vehicle that can be requested is accepted');
select is(pg_temp.plate('r1'), 'VA', 'The request keeps the chosen vehicle');

-- A schedule takes only requests for its own vehicle ------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000cd');
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'VS', array[pg_temp.id('r1')], pg_temp.legs('r1')) $$,
  '22023', 'A selected request is for VA, not VS. Remove it from this trip',
  'A request cannot go on a vehicle its requester did not choose');
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'VA', array[pg_temp.id('r1')], pg_temp.legs('r1')) $$,
  '22023', 'VA can be requested for company trips, so it isn''t used for Daily trips',
  'Nor on a Daily trip with its own vehicle: those are Company trips (0054)');
select lives_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'VS', array[pg_temp.id('daily')], pg_temp.legs('daily')) $$,
  'A request with no vehicle may go on any vehicle');

-- Sent back, then another vehicle: back in the pool -------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
insert into ids select 'r2', id from pg_temp.make('VA');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000cd');
select send_back_requests(array[pg_temp.id('r2')], 'Mirage A is already out that day');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
select pg_temp.edit('r2', 'VC');
select is((select sent_back_at from requests where id = pg_temp.id('r2')), null,
  'Choosing another vehicle returns a sent-back request to the pool');

-- Renaming a vehicle carries its requests -----------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000cb');
select rename_vehicle('VC', 'VZ', 'Mirage C', 'Active', null);
select is(pg_temp.plate('r2'), 'VZ', 'A renamed plate follows onto the request');

-- An unchanged vehicle is kept after it stops being offered -----------------
reset role;
update vehicles set company_trips = false where plate = 'VZ';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
select lives_ok($$ select pg_temp.edit('r2', 'VZ') $$, 'Editing keeps a vehicle that is no longer offered');
select throws_ok($$ select pg_temp.edit('r2', 'VS') $$, '22023', 'This vehicle can''t be requested for company trips',
  'Switching to one that is not offered is refused');

-- A split-off part keeps the vehicle ----------------------------------------
insert into ids select 'r3', id from create_request(pg_temp.d(), 'REGULAR', null, null,
  '[{"destinationId":"dc","purposeId":"pc"},{"destinationId":"dc2","purposeId":"pc"}]', 'VA');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000cd');
select lives_ok(
  $$ insert into ids select 'r3b', id from split_request(pg_temp.id('r3'),
       array(select id from request_destinations where request_id = pg_temp.id('r3') and destination_id = 'dc2' and active)) $$,
  'The Scheduler splits a stop off');
select is(pg_temp.plate('r3b'), 'VA', 'The split-off request keeps the chosen vehicle');

select * from finish();
rollback;

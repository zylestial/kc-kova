-- v2.2: "Other" destination and purpose on a request stop
-- (0036_request_other_destination_purpose.sql), and typed names becoming
-- request choices (0049).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000002a', 'req3@test.local'),
  ('00000000-0000-0000-0000-00000000002d', 'sched3@test.local'),
  ('00000000-0000-0000-0000-00000000002e', 'driver4@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000002a', 'req3', 'Rosa Requester', 'Requester'),
  ('00000000-0000-0000-0000-00000000002d', 'sched3', 'Sid Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000002e', 'driver4', 'Diego Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V10', 'Van 10', '00000000-0000-0000-0000-00000000002e');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd10', 'City Hall 3', 'Active'),
  ('purposes', 'p10', 'Inspection', 'Active'),
  -- Retired choices: a typed name matching one stays a typed "Other" (0049),
  -- which is what the Other-stop tests below need.
  ('destinations', 'wx', 'Warehouse X', 'Inactive'),
  ('destinations', 'ds', 'Different Site', 'Inactive'),
  ('purposes', 'dp', 'Deliver parts', 'Inactive'),
  ('purposes', 'oe', 'Other errand', 'Inactive');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date + 10;
$$;

-- Create/edit validation -----------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000002a');

select throws_ok(
  $$ select create_request(pg_temp.d(), 'REGULAR', null, null,
       '[{"destinationId":"d10","destinationOther":"Warehouse X","purposeId":"p10"}]', null) $$,
  '22023', null, 'A destination id and Other text together are rejected');
select throws_ok(
  $$ select create_request(pg_temp.d(), 'REGULAR', null, null,
       '[{"destinationId":"d10","purposeId":"p10","purposeOther":"Deliver parts"}]', null) $$,
  '22023', null, 'A purpose id and Other text together are rejected');
select throws_ok(
  $$ select create_request(pg_temp.d(), 'REGULAR', null, null,
       '[{"purposeId":"p10"}]', null) $$,
  '22023', null, 'No destination id and no Other text is rejected');

select lives_ok(
  $$ select create_request(pg_temp.d(), 'REGULAR', null, null,
       '[{"destinationOther":"Warehouse X","purposeOther":"Deliver parts"}]', null) $$,
  'Other destination and Other purpose together are accepted');

create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
insert into ids select 'rosa', id from requests where owner_account_id = '00000000-0000-0000-0000-00000000002a';
insert into ids select 'rosa_rd', (select id from request_destinations where request_id = v and active) from ids where k = 'rosa';
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;

select is(
  (select destination_name from request_destinations where id = pg_temp.id('rosa_rd')),
  'Warehouse X', 'The typed Other destination text is stored as the snapshot name');
select ok(
  (select destination_is_other from request_destinations where id = pg_temp.id('rosa_rd')),
  'destination_is_other is set');
select is(
  (select destination_id from request_destinations where id = pg_temp.id('rosa_rd')),
  null, 'destination_id is null for an Other destination');
select ok(
  (select purpose_is_other from request_destinations where id = pg_temp.id('rosa_rd')),
  'purpose_is_other is set');

reset role;

-- Planner: a leg serving only Other-destination stops -----------------------
create function pg_temp.rv() returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = pg_temp.id('sched') and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
create function pg_temp.other_leg() returns jsonb language sql as $$
  select jsonb_build_object('plannedTimeOut', '08:00', 'plannedTimeIn', '08:30',
    'stops', jsonb_build_array(pg_temp.id('rosa_rd')));
$$;
create function pg_temp.final_leg() returns jsonb language sql as $$
  select jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:00', 'plannedTimeIn', '10:00');
$$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000002d');
select lives_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V10', array[pg_temp.id('rosa')],
       jsonb_build_array(pg_temp.other_leg(), pg_temp.final_leg())) $$,
  'A leg serving only an Other-destination stop is accepted with no destinationId');
reset role;
insert into ids select 'sched', id from schedules where created_by_account_id = '00000000-0000-0000-0000-00000000002d';

select is(
  (select destination_id from schedule_legs
   where revision_id = (select id from schedule_revisions where schedule_id = pg_temp.id('sched') and status = 'DRAFT')
     and leg_no = 1),
  null, 'The saved leg has no destination_id');
select is(
  (select destination_name from schedule_legs
   where revision_id = (select id from schedule_revisions where schedule_id = pg_temp.id('sched') and status = 'DRAFT')
     and leg_no = 1),
  'Warehouse X', 'The saved leg''s destination_name comes from the stop');

-- A second Requester's differently-named Other stop cannot share that leg.
select pg_temp.act_as('00000000-0000-0000-0000-00000000002a');
select create_request(pg_temp.d(), 'REGULAR', null, null,
  '[{"destinationOther":"Different Site","purposeOther":"Other errand"}]', null);
reset role;
insert into ids select 'rosa2', id from requests
  where owner_account_id = '00000000-0000-0000-0000-00000000002a' and id <> pg_temp.id('rosa');
insert into ids select 'rosa2_rd', (select id from request_destinations where request_id = v and active) from ids where k = 'rosa2';

select pg_temp.act_as('00000000-0000-0000-0000-00000000002d');
select throws_ok(
  format(
    $$ select save_schedule_draft(%L::uuid, %s, pg_temp.d(), 'V10', array[pg_temp.id('rosa'), pg_temp.id('rosa2')],
         jsonb_build_array(
           jsonb_build_object('plannedTimeOut', '08:00', 'plannedTimeIn', '08:30',
             'stops', jsonb_build_array(pg_temp.id('rosa_rd'), pg_temp.id('rosa2_rd'))),
           pg_temp.final_leg())) $$,
    pg_temp.id('sched'), pg_temp.rv()
  ),
  '22023', 'Leg 1: a stop''s destination doesn''t match the leg''s destination',
  'Two Other stops with different free text cannot share one leg');

-- Typed names become choices (0049) ---------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000002a');
insert into ids select 'w1', id from create_request(pg_temp.d(), 'REGULAR', null, null,
  '[{"destinationOther":"  Wilcon   Calasiao ","purposeOther":"Pick up tiles"}]', null);
reset role;
select is((select count(*)::int from booking_options where "group" = 'destinations' and name = 'Wilcon Calasiao'), 1,
  'A new typed destination becomes a choice, tidied');
select is((select destination_id from request_destinations where request_id = pg_temp.id('w1') and active),
  (select id from booking_options where "group" = 'destinations' and name = 'Wilcon Calasiao'),
  'and the request uses that choice');
select is((select purpose_is_other from request_destinations where request_id = pg_temp.id('w1') and active), false,
  'A new typed purpose becomes a choice too');
select pg_temp.act_as('00000000-0000-0000-0000-00000000002a');
insert into ids select 'w2', id from create_request(pg_temp.d(), 'REGULAR', null, null,
  '[{"destinationOther":"WILCON calasiao","purposeId":"p10"}]', null);
reset role;
select is((select count(*)::int from booking_options where "group" = 'destinations' and option_name_key(name) = 'wilcon calasiao'), 1,
  'Typing it again, in other capitals, adds no duplicate');
select is((select destination_name from request_destinations where request_id = pg_temp.id('w2') and active), 'Wilcon Calasiao',
  'and uses the existing choice''s name');

select * from finish();
rollback;

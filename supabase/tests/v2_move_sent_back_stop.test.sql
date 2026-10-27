-- A requester moves a sent-back stop to another day while the rest of its
-- request is being scheduled (0081_move_sent_back_stop.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008a1', 'ana8@test.local'),
  ('00000000-0000-0000-0000-0000000008a2', 'bea8@test.local'),
  ('00000000-0000-0000-0000-0000000008a3', 'sam8@test.local'),
  ('00000000-0000-0000-0000-0000000008a4', 'dee8@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000008a1', 'ana8', 'Ana Eight', 'Requester'),
  ('00000000-0000-0000-0000-0000000008a2', 'bea8', 'Bea Eight', 'Requester'),
  ('00000000-0000-0000-0000-0000000008a3', 'sam8', 'Sam Eight', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000008a4', 'dee8', 'Dee Eight', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values ('V81', 'Van 81', '00000000-0000-0000-0000-0000000008a4');
insert into booking_options ("group", id, name, status) values
  ('projects', 'p81', 'Riverside Townhomes', 'Active'),
  ('destinations', 'd81', 'City Hall', 'Active'),
  ('destinations', 'd82', 'Wilcon Depot', 'Active'),
  ('purposes', 'u81', 'Site visit', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d(p_days int) returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date + p_days;
$$;
create function pg_temp.stop(p_dest text) returns jsonb language sql as $$
  select jsonb_build_object('projectId', 'p81', 'destinationId', p_dest, 'purposeId', 'u81', 'flexibility', 'DAY');
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;

-- Ana asks for two stops in 5 days, and another one-stop request.
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
insert into ids select 'g', (create_request_group('DAILY', jsonb_build_object('date', pg_temp.d(5),
  'stops', jsonb_build_array(pg_temp.stop('d81'), pg_temp.stop('d82'))))).id;
insert into ids select 'h', (create_request_group('DAILY', jsonb_build_object('date', pg_temp.d(5),
  'stops', jsonb_build_array(pg_temp.stop('d81'))))).id;
reset role;
insert into ids select 'a', id from requests where group_id = pg_temp.id('g') and stop_letter = 'A';
insert into ids select 'b', id from requests where group_id = pg_temp.id('g') and stop_letter = 'B';
insert into ids select 'a_rd', (select id from request_destinations where request_id = pg_temp.id('a') and active);
insert into ids select 'c', id from requests where group_id = pg_temp.id('h');

-- Sam puts stop A on a trip and sends B, and the other request, back.
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a3');
select save_schedule_draft(null, null, pg_temp.d(5), 'V81', array[pg_temp.id('a')],
  jsonb_build_array(
    jsonb_build_object('destinationId', 'd81', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
      'stops', jsonb_build_array(pg_temp.id('a_rd'))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30')));
select send_back_requests(array[pg_temp.id('b'), pg_temp.id('c')], 'The van is full that day');

select throws_ok(
  format('select move_sent_back_stop(%L, %L)', pg_temp.id('b'), pg_temp.d(8)),
  '42501', 'Not authorized', 'A Scheduler cannot move a requester''s stop this way');

select pg_temp.act_as('00000000-0000-0000-0000-0000000008a2');
select throws_ok(
  format('select move_sent_back_stop(%L, %L)', pg_temp.id('b'), pg_temp.d(8)),
  'P0002', 'Request not found', 'Nor can another requester');

select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
select throws_ok(
  format('select move_sent_back_stop(%L, %L)', pg_temp.id('a'), pg_temp.d(8)),
  '22023', 'Only a stop the Scheduler sent back can be moved this way', 'A stop that wasn''t sent back stays');
select throws_ok(
  format('select move_sent_back_stop(%L, %L)', pg_temp.id('c'), pg_temp.d(8)),
  '22023', 'Edit the request to change its date', 'Nothing else of the request is being scheduled: edit it instead');
select throws_ok(
  format('select move_sent_back_stop(%L, %L)', pg_temp.id('b'), pg_temp.d(-1)),
  '22023', 'That day has passed. Pick today or a later day', 'Not to a past day');
select throws_ok(
  format('select update_request_group(%L, 1, %L)', pg_temp.id('g'), jsonb_build_object('date', pg_temp.d(8),
    'stops', jsonb_build_array(pg_temp.stop('d81') || jsonb_build_object('id', pg_temp.id('a')),
      pg_temp.stop('d82') || jsonb_build_object('id', pg_temp.id('b'))))),
  '22023', 'Part of this request is already being scheduled, so its date and trip details can no longer be changed',
  'The request''s own date is still locked');

insert into ids select 'n', (move_sent_back_stop(pg_temp.id('b'), pg_temp.d(8))).id;
reset role;
select isnt(pg_temp.id('n'), pg_temp.id('g'), 'The stop is now a request of its own');
select is((select group_id from requests where id = pg_temp.id('b')), pg_temp.id('n'), 'It moved to the new request');
select is((select stop_letter from requests where id = pg_temp.id('b')), 'A', 'as its stop A');
select is((select requested_date from requests where id = pg_temp.id('b')), pg_temp.d(8), 'on the new day');
select is((select requested_date from request_groups where id = pg_temp.id('n')), pg_temp.d(8), 'The new request is for that day');
select ok((select owner_account_id = '00000000-0000-0000-0000-0000000008a1' and form_type = 'DAILY'
  from request_groups where id = pg_temp.id('n')), 'Same requester and form');
select is((select progress from request_progress where request_id = pg_temp.id('b')), 'NOT_YET_SCHEDULED',
  'It is back with the Scheduler');
select is((select count(*)::int from requests where group_id = pg_temp.id('g') and status = 'ACTIVE'), 1,
  'The old request keeps the stop being scheduled');
select is((select requested_date from request_groups where id = pg_temp.id('g')), pg_temp.d(5), 'on its own day');

-- Nothing of the new request is being scheduled, so Ana can edit its date.
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
select lives_ok(
  format('select update_request_group(%L, 1, %L)', pg_temp.id('n'), jsonb_build_object('date', pg_temp.d(9),
    'stops', jsonb_build_array(pg_temp.stop('d82') || jsonb_build_object('id', pg_temp.id('b'))))),
  'The new request can be edited like any other');

select * from finish();
rollback;

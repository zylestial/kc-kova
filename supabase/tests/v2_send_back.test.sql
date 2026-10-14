-- v2.4: a Scheduler sends an unplaced request back to its requester
-- (0038_send_back_request.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- These tests are about scheduling, not the vehicle a request names
-- (v2_request_vehicle.test.sql), so any vehicle may take any request here.
alter table revision_requests disable trigger revision_requests_request_vehicle;

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000005a', 'juan5@test.local'),
  ('00000000-0000-0000-0000-00000000005b', 'maria5@test.local'),
  ('00000000-0000-0000-0000-00000000005d', 'sched5@test.local'),
  ('00000000-0000-0000-0000-00000000005e', 'driver5@test.local'),
  ('00000000-0000-0000-0000-00000000005f', 'driver6@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000005a', 'juan5', 'Juan Five', 'Requester'),
  ('00000000-0000-0000-0000-00000000005b', 'maria5', 'Maria Five', 'Requester'),
  ('00000000-0000-0000-0000-00000000005d', 'sched5', 'Sam Five', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000005e', 'driver5', 'Dee Five', 'Driver'),
  ('00000000-0000-0000-0000-00000000005f', 'driver6', 'Dot Six', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V55', 'Van 55', '00000000-0000-0000-0000-00000000005e'),
  -- A second van, since V55 can take only one schedule a day (0048).
  ('V56', 'Van 56', '00000000-0000-0000-0000-00000000005f');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd55', 'City Hall 55', 'Active'),
  ('purposes', 'p55', 'Inspection', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d(p_days int) returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date + p_days;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000005a');
select create_request(pg_temp.d(10), 'REGULAR', null, null, '[{"destinationId":"d55","purposeId":"p55"}]', 'V55');
select pg_temp.act_as('00000000-0000-0000-0000-00000000005b');
select create_request(pg_temp.d(10), 'REGULAR', null, null, '[{"destinationId":"d55","purposeId":"p55"}]', 'V55');
reset role;

create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
insert into ids select 'juan', id from requests where owner_account_id = '00000000-0000-0000-0000-00000000005a';
insert into ids select 'maria', id from requests where owner_account_id = '00000000-0000-0000-0000-00000000005b';
insert into ids select 'maria_rd', (select id from request_destinations where request_id = v and active) from ids where k = 'maria';
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;

-- Who may send back --------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000005a');
select throws_ok(
  $$ select send_back_requests(array[pg_temp.id('juan')], '') $$,
  '42501', 'Only a Scheduler can send requests back',
  'A Requester cannot send a request back');

-- A request already in a schedule can't be sent back -----------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000005d');
select save_schedule_draft(null, null, pg_temp.d(10), 'V55', array[pg_temp.id('maria')],
  jsonb_build_array(
    jsonb_build_object('destinationId', 'd55', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
      'stops', jsonb_build_array(pg_temp.id('maria_rd'))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30')));
select throws_ok(
  $$ select send_back_requests(array[pg_temp.id('juan'), pg_temp.id('maria')], 'No vehicle') $$,
  '22023', 'A request is already in a schedule; remove it from that schedule first',
  'Sending back a scheduled request is refused, for the whole batch');
select is(
  (select sent_back_at from requests where id = pg_temp.id('juan')), null,
  'A refused batch sends nothing back');

-- Sending back an unplaced request -----------------------------------------
select lives_ok(
  $$ select send_back_requests(array[pg_temp.id('juan')], '  All vehicles are full  ') $$,
  'A Scheduler sends an unplaced request back');
select is(
  (select progress from request_progress where request_id = pg_temp.id('juan')), 'SENT_BACK',
  'Its progress is SENT_BACK');
select is(
  (select sent_back_reason from requests where id = pg_temp.id('juan')), 'All vehicles are full',
  'The reason is stored trimmed');
-- Notifications are only readable by their recipient, so check as superuser.
reset role;
select is(
  (select count(*)::int from notifications
   where account_id = '00000000-0000-0000-0000-00000000005a' and type = 'REQUEST_SENT_BACK' and related_request_id = pg_temp.id('juan')),
  1, 'The requester is notified');
select pg_temp.act_as('00000000-0000-0000-0000-00000000005d');
select lives_ok(
  $$ select send_back_requests(array[pg_temp.id('juan')], '') $$,
  'Sending it back again is a no-op');
reset role;
select is(
  (select count(*)::int from notifications where related_request_id = pg_temp.id('juan') and type = 'REQUEST_SENT_BACK'),
  1, 'A repeat send-back sends no second notification');

-- No schedule can take it while it's sent back -----------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000005d');
select throws_ok(
  format(
    $$ select save_schedule_draft(null, null, pg_temp.d(10), 'V56', array[%L::uuid],
         jsonb_build_array(
           jsonb_build_object('destinationId', 'd55', 'plannedTimeOut', '11:00', 'plannedTimeIn', '12:00',
             'stops', (select jsonb_agg(id) from request_destinations where request_id = %L::uuid and active)),
           jsonb_build_object('isFinal', true, 'plannedTimeOut', '12:30', 'plannedTimeIn', '13:30'))) $$,
    pg_temp.id('juan'), pg_temp.id('juan')
  ),
  '22023', 'A request in this schedule was sent back to its requester; remove it first',
  'A sent-back request cannot be put in a schedule');

-- Moving it to another day puts it back in the pool -------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000005a');
select update_request(
  pg_temp.id('juan'), (select row_version from requests where id = pg_temp.id('juan')),
  pg_temp.d(12), 'REGULAR', null, null, '[{"destinationId":"d55","purposeId":"p55"}]', 'V55');
select is(
  (select progress from request_progress where request_id = pg_temp.id('juan')), 'NOT_YET_SCHEDULED',
  'A new date clears the send-back');
select is(
  (select sent_back_reason from requests where id = pg_temp.id('juan')), '',
  'The old reason is cleared too');

-- The requester can still cancel a sent-back request instead ---------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000005d');
select send_back_requests(array[pg_temp.id('juan')], '');
select pg_temp.act_as('00000000-0000-0000-0000-00000000005a');
select lives_ok(
  format($$ select cancel_request(%L::uuid) $$, pg_temp.id('juan')),
  'A sent-back request can be cancelled by its owner');

select * from finish();
rollback;

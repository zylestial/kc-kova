-- v2 cancellation: direct cancel, cancellation requests (decline/confirm),
-- shared stops, Admin schedule cancel, unlocking, reservations, completion
-- guard, idempotency.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(68);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'juan@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'maria@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-000000000010', 'driver2@test.local'),
  ('00000000-0000-0000-0000-000000000011', 'driver3@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000b', 'juan', 'Juan', 'Requester'),
  ('00000000-0000-0000-0000-00000000000c', 'maria', 'Maria', 'Requester'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-000000000010', 'driver2', 'Dee Driver', 'Driver'),
  ('00000000-0000-0000-0000-000000000011', 'driver3', 'Dot Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e'),
  ('V2', 'Van 2', '00000000-0000-0000-0000-000000000010'),
  -- s2 gets its own van, since a vehicle takes only one schedule a day (0048).
  ('V3', 'Van 3', '00000000-0000-0000-0000-000000000011');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd1', 'City Hall', 'Active'),
  ('destinations', 'd2', 'Port Office', 'Active'),
  ('purposes', 'p1', 'Inspection', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date + 10;
$$;
-- Requests, all for the same date, all to City Hall unless named otherwise:
--   juan, maria     shared stop on S1 (V1, approved)
--   port            alone on S2 (V2, approved)
--   x1 (Maria), x2 (Juan), x3 (Maria)   S3 (V2, approved)
--   solo (Juan)     never scheduled
--   spare (Juan)    kept for re-inclusion after S3 is cancelled
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into ids select 'juan', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]');
insert into ids select 'x2', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]');
insert into ids select 'solo', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d2","purposeId":"p1"}]');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
insert into ids select 'maria', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]');
insert into ids select 'port', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d2","purposeId":"p1"}]');
insert into ids select 'x1', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]');
insert into ids select 'x3', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]');
reset role;
insert into ids select k || '_rd', (select id from request_destinations where request_id = v and active) from ids;

create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.rv(p_schedule uuid) returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = p_schedule and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
-- One stop leg to p_dest serving the named request destinations, then home.
create function pg_temp.legs(p_dest text, p_stops text[], p_out text, p_in text, p_back_out text, p_back_in text)
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('destinationId', p_dest, 'plannedTimeOut', p_out, 'plannedTimeIn', p_in,
      'stops', (select coalesce(jsonb_agg(pg_temp.id(s)), '[]'::jsonb) from unnest(p_stops) as s)),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', p_back_out, 'plannedTimeIn', p_back_in));
$$;
-- Scheduler saves and submits, Admin approves. Returns the schedule id.
create function pg_temp.publish(p_plate text, p_requests text[], p_legs jsonb) returns uuid language plpgsql as $$
declare
  v_revision schedule_revisions;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
  select * into v_revision from save_schedule_draft(null, null, pg_temp.d(), p_plate,
    (select array_agg(pg_temp.id(r)) from unnest(p_requests) as r), p_legs);
  perform submit_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  perform pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
  perform approve_schedule(v_revision.schedule_id, pg_temp.rv(v_revision.schedule_id));
  reset role;
  return v_revision.schedule_id;
end;
$$;
create function pg_temp.pending(p_k text) returns uuid language sql as $$
  select id from request_cancellations where request_id = pg_temp.id(p_k) and status = 'PENDING';
$$;
grant execute on function pg_temp.pending(text) to authenticated;

insert into ids values
  ('s1', pg_temp.publish('V1', array['juan', 'maria'], pg_temp.legs('d1', array['juan_rd', 'maria_rd'], '08:00', '09:00', '09:30', '10:30')));
insert into ids values
  ('s2', pg_temp.publish('V3', array['port'], pg_temp.legs('d2', array['port_rd'], '10:00', '11:00', '11:30', '12:30')));
insert into ids values
  ('s3', pg_temp.publish('V2', array['x1', 'x2', 'x3'], pg_temp.legs('d1', array['x1_rd', 'x2_rd', 'x3_rd'], '13:00', '14:00', '14:30', '15:30')));

-- Cancelling an unscheduled request -----------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select throws_ok($$ select cancel_request(pg_temp.id('solo')) $$, 'P0002', null,
  'A Requester cannot cancel someone else''s request');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select cancel_request(pg_temp.id('solo')) $$, '42501', null,
  'A Scheduler cannot cancel a request');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select cancel_request(pg_temp.id('solo')) $$, '42501', null,
  'A Driver cannot cancel a request');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select cancel_request(pg_temp.id('juan')) $$, '22023', null,
  'A request in a schedule can''t be cancelled directly');
select lives_ok($$ select cancel_request(pg_temp.id('solo')) $$, 'The owner cancels an unscheduled request immediately');
select is((select progress from request_progress where request_id = pg_temp.id('solo')), 'CANCELLED',
  'Its progress reads CANCELLED');
select lives_ok($$ select cancel_request(pg_temp.id('solo')) $$, 'Repeating the cancellation is safe');
select is((select row_version from requests where id = pg_temp.id('solo')), 2,
  'A repeat does not change the request again');
select throws_ok($$ select request_cancellation(pg_temp.id('solo'), '') $$, '22023', null,
  'A cancelled request can''t be asked to cancel again');
select is((select count(*)::int from requests where status = 'CANCELLED'), 1,
  'No other request was cancelled');

-- Asking to cancel an included request ---------------------------------------
select throws_ok($$ select request_cancellation(pg_temp.id('maria'), '') $$, 'P0002', null,
  'Only the owner can ask to cancel a request');
select lives_ok($$ select request_cancellation(pg_temp.id('juan'), 'No longer needed') $$,
  'The owner asks to cancel a request that is in an approved schedule');
select is((select cancellation_pending from request_progress where request_id = pg_temp.id('juan')), true,
  'The request is flagged as cancellation pending');
select is((select progress from request_progress where request_id = pg_temp.id('juan')), 'APPROVED',
  'It keeps its real progress while the cancellation is pending');
select is((select id from request_cancellations where request_id = pg_temp.id('juan')),
  (select request_cancellation(pg_temp.id('juan'), 'No longer needed')).id,
  'Asking twice returns the same pending row');
select is((select count(*)::int from request_cancellations where request_id = pg_temp.id('juan')), 1,
  'There is still exactly one cancellation row');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select is((select cancellation_pending from request_progress where request_id = pg_temp.id('juan')), true,
  'The Scheduler can see that a cancellation is pending');
select throws_ok($$ select confirm_cancellation(pg_temp.pending('juan')) $$, '42501', null,
  'A Scheduler cannot confirm a cancellation');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select decline_cancellation(pg_temp.pending('juan'), 'x') $$, '42501', null,
  'A Requester cannot decide their own cancellation');

-- Decline --------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select decline_cancellation(pg_temp.pending('juan'), '  ') $$, '22023', null,
  'Declining needs a note');
select lives_ok($$ select decline_cancellation(pg_temp.pending('juan'), 'Driver already notified') $$,
  'Admin declines the cancellation');
select is((select status from requests where id = pg_temp.id('juan')), 'ACTIVE', 'The request stays active');
select is((select status from schedules where id = pg_temp.id('s1')), 'ACTIVE', 'The schedule stays active');
select is((select count(*)::int from schedule_requests where schedule_id = pg_temp.id('s1') and active), 2,
  'Both requests are still held by the schedule');
select lives_ok($$ select decline_cancellation((select id from request_cancellations where request_id = pg_temp.id('juan')), 'Driver already notified') $$,
  'Repeating the decline is safe');
select throws_ok($$ select confirm_cancellation((select id from request_cancellations where request_id = pg_temp.id('juan'))) $$, '22023', null,
  'A declined cancellation can''t be confirmed');

-- Confirm on a shared stop -----------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select lives_ok($$ select request_cancellation(pg_temp.id('maria'), 'Trip moved') $$,
  'Maria asks to cancel her request on the shared stop');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select confirm_cancellation(pg_temp.pending('maria')) $$, 'Admin confirms it');
select lives_ok($$ select confirm_cancellation((select id from request_cancellations where request_id = pg_temp.id('maria'))) $$,
  'Repeating the confirmation is safe');
reset role;
select is((select status from requests where id = pg_temp.id('maria')), 'CANCELLED', 'Maria''s request is cancelled');
select is((select status from requests where id = pg_temp.id('juan')), 'ACTIVE', 'Juan''s request on the same stop is not');
select is((select status from schedules where id = pg_temp.id('s1')), 'ACTIVE', 'The schedule continues for Juan');
select is((select count(*)::int from schedule_requests where schedule_id = pg_temp.id('s1') and active), 1,
  'Only Juan''s request is still held; Maria''s is released');
select is((select count(*)::int from schedule_reservations where schedule_id = pg_temp.id('s1')), 1,
  'The published version keeps its reservation until a new version replaces it');
select is((select count(*)::int from revision_requests rr join schedules s on s.published_revision_id = rr.revision_id
           where s.id = pg_temp.id('s1')), 2,
  'The published version is preserved as approved, still listing both requests');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok(
  $$ select save_schedule_draft(pg_temp.id('s1'), null, null, 'V1', array[pg_temp.id('juan'), pg_temp.id('maria')],
       pg_temp.legs('d1', array['juan_rd', 'maria_rd'], '08:00', '09:00', '09:30', '10:30')) $$,
  '22023', null, 'The Scheduler can''t put the cancelled request back into a new version');
select lives_ok(
  $$ select save_schedule_draft(pg_temp.id('s1'), null, null, 'V1', array[pg_temp.id('juan')],
       pg_temp.legs('d1', array['juan_rd'], '08:00', '09:00', '09:30', '10:30')) $$,
  'The Scheduler proposes a version without the cancelled request');
select lives_ok($$ select submit_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$, 'and submits it');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$,
  'Admin approves the changed route');
reset role;
select is((select count(*)::int from leg_stops ls join schedules s on s.published_revision_id = ls.revision_id
           where s.id = pg_temp.id('s1')), 1,
  'The published version serves only Juan''s stop');
select is((select count(*)::int from schedule_revisions where schedule_id = pg_temp.id('s1') and status = 'SUPERSEDED'), 1,
  'The earlier approved version is kept as superseded history');

-- Confirming the only request cancels the whole schedule ----------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select request_cancellation(pg_temp.id('port'), 'Not needed');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select confirm_cancellation(pg_temp.pending('port')) $$, 'Admin confirms the only request of a schedule');
reset role;
select is((select status from schedules where id = pg_temp.id('s2')), 'CANCELLED',
  'The schedule with no live request left is cancelled');
select is((select count(*)::int from schedule_reservations where schedule_id = pg_temp.id('s2')), 0,
  'Its reservation is freed');
select is((select count(*)::int from schedule_requests where schedule_id = pg_temp.id('s2') and active), 0,
  'It holds no request');

-- Admin cancels a schedule -----------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select request_cancellation(pg_temp.id('x3'), 'x3 out');
select request_cancellation(pg_temp.id('x1'), 'x1 out');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select confirm_cancellation(pg_temp.pending('x3'));
reset role;
create temp table x3_before as select cancelled_at from requests where id = pg_temp.id('x3');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select cancel_schedule(pg_temp.id('s3'), 'reason') $$, '42501', null, 'A Scheduler cannot cancel a schedule');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select cancel_schedule(pg_temp.id('s3'), ' ') $$, '22023', null, 'Cancelling a schedule needs a reason');
select lives_ok($$ select cancel_schedule(pg_temp.id('s3'), 'Vehicle in the garage') $$, 'Admin cancels the schedule');
select lives_ok($$ select cancel_schedule(pg_temp.id('s3'), 'Vehicle in the garage') $$, 'Repeating it is safe');
reset role;
select is((select status from schedules where id = pg_temp.id('s3')), 'CANCELLED', 'The schedule is cancelled');
select is((select status from requests where id = pg_temp.id('x1')), 'CANCELLED',
  'A request whose cancellation was pending is cancelled');
select is((select status from requests where id = pg_temp.id('x2')), 'ACTIVE', 'A still-needed request stays active');
select is((select count(*)::int from schedule_requests where schedule_id = pg_temp.id('s3') and active), 0,
  'It is released, so it is unlocked');
select is((select cancelled_at from requests where id = pg_temp.id('x3')), (select cancelled_at from x3_before),
  'A request that was already cancelled keeps its original cancellation');
select is((select count(*)::int from schedule_reservations where schedule_id = pg_temp.id('s3')), 0,
  'The schedule''s reservation is freed');
select is((select count(*)::int from schedule_revisions where schedule_id = pg_temp.id('s3') and status = 'APPROVED'), 1,
  'The approved version is kept as history');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select progress from request_progress where request_id = pg_temp.id('x2')), 'NOT_YET_SCHEDULED',
  'The still-needed request is back to Not yet scheduled');
select lives_ok($$ select update_request(pg_temp.id('x2'), (select row_version from requests where id = pg_temp.id('x2')),
  pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  'and its owner can edit it again');
-- The edit replaced the request's destination row.
reset role;
update ids set v = (select id from request_destinations where request_id = pg_temp.id('x2') and active) where k = 'x2_rd';
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V2', array[pg_temp.id('x2')],
       pg_temp.legs('d1', array['x2_rd'], '13:00', '14:00', '14:30', '15:30')) $$,
  'A Scheduler can schedule it again on the same vehicle and time');
select throws_ok($$ select save_schedule_draft(pg_temp.id('s3'), null, null, 'V2', array[pg_temp.id('x2')],
  pg_temp.legs('d1', array['x2_rd'], '13:00', '14:00', '14:30', '15:30')) $$, '22023', null,
  'A cancelled schedule can''t be edited');

-- Removing a request from a draft unlocks it ------------------------------------------------
select lives_ok(
  $$ select save_schedule_draft((select schedule_id from schedule_requests where request_id = pg_temp.id('x2') and active), pg_temp.rv((select schedule_id from schedule_requests where request_id = pg_temp.id('x2') and active)), null, 'V2',
       array[pg_temp.id('x2')], pg_temp.legs('d1', array['x2_rd'], '13:30', '14:00', '14:30', '15:00')) $$,
  'Saving a draft with new times moves its reservation');
reset role;
select is((select lower(period) from schedule_reservations
           where schedule_id = (select schedule_id from schedule_requests where request_id = pg_temp.id('x2') and active)),
  (pg_temp.d() + time '13:30') at time zone 'Asia/Manila', 'The reservation follows the new times');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok($$ select discard_schedule_draft(
  (select schedule_id from schedule_requests where request_id = pg_temp.id('x2') and active),
  (select row_version from schedule_revisions where status = 'DRAFT' and schedule_id =
    (select schedule_id from schedule_requests where request_id = pg_temp.id('x2') and active))) $$,
  'The Scheduler discards an unused draft');
reset role;
select is((select count(*)::int from schedule_reservations r join schedules s on s.id = r.schedule_id where s.status <> 'ACTIVE'), 0,
  'No reservation is left on a cancelled or discarded schedule');
select is((select count(*)::int from schedule_requests sr join requests r on r.id = sr.request_id
           where sr.active and r.status = 'CANCELLED'), 0,
  'No cancelled request is left locked into a schedule');
select is((select count(*)::int from schedule_requests sr join schedules s on s.id = sr.schedule_id
           where sr.active and s.status <> 'ACTIVE'), 0,
  'No request is left locked by a cancelled or discarded schedule');

-- A submitted completion blocks cancellation ---------------------------------------------------
insert into ids values
  ('s4', pg_temp.publish('V2', array['x2'], pg_temp.legs('d1', array['x2_rd'], '16:00', '17:00', '17:30', '18:00')));
insert into trip_completions (schedule_id, revision_id, driver_id, start_odometer, end_odometer)
select s.id, s.published_revision_id, '00000000-0000-0000-0000-000000000010', 100, 120
from schedules s where s.id = pg_temp.id('s4');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select request_cancellation(pg_temp.id('x2'), '') $$, '22023', null,
  'A request can''t be cancelled once the Driver has submitted the trip');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select cancel_schedule(pg_temp.id('s4'), 'Oops') $$, '22023', null,
  'Admin can''t cancel a schedule whose trip has been submitted');

select * from finish();
rollback;

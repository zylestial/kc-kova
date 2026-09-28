-- v2.2 notifications: created by the right RPC for the right recipient(s),
-- and RLS/mark-read isolate each account's own rows.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000f', 'admin2@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'juan@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'maria@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-000000000010', 'driver2@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000f', 'admin2', 'Alex Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000b', 'juan', 'Juan', 'Requester'),
  ('00000000-0000-0000-0000-00000000000c', 'maria', 'Maria', 'Requester'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-000000000010', 'driver2', 'Dee Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e'),
  ('V2', 'Van 2', '00000000-0000-0000-0000-000000000010');
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
--   juan, maria   shared stop on S1 (V1, approved)
--   port          alone on S2 (V2, approved)
--   solo (Juan)   alone on S3 (V2, approved), for the direct-cancel scenario
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into ids select 'juan', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
insert into ids select 'maria', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]');
insert into ids select 'port', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d2","purposeId":"p1"}]');
reset role;
insert into ids select k || '_rd', (select id from request_destinations where request_id = v and active) from ids;

create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.rv(p_schedule uuid) returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = p_schedule and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
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
create function pg_temp.count_for(p_account uuid, p_type text) returns int language sql as $$
  select count(*)::int from notifications where account_id = p_account and type = p_type;
$$;

-- Everything above is fixture setup, run before any RPC we're testing fires
-- a notification -- clear it so counts below reflect only the calls we make.
delete from notifications;

-- submit_schedule / return_schedule / approve_schedule, walked by hand
-- (not through pg_temp.publish) so we can inspect notifications between
-- each step ------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select * into temp v1 from save_schedule_draft(null, null, pg_temp.d(), 'V1',
  array[pg_temp.id('juan'), pg_temp.id('maria')],
  pg_temp.legs('d1', array['juan_rd', 'maria_rd'], '08:00', '09:00', '09:30', '10:30'));
insert into ids values ('s1', (select schedule_id from v1));
select submit_schedule((select schedule_id from v1), (select row_version from v1));
reset role;
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000a', 'SCHEDULE_SUBMITTED'), 1,
  'The first Admin is notified a schedule was submitted');
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000f', 'SCHEDULE_SUBMITTED'), 1,
  'So is the second Admin');
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000d', 'SCHEDULE_SUBMITTED'), 0,
  'The submitting Scheduler is not notified about their own submission');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select return_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')), 'Fix the time');
reset role;
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000d', 'SCHEDULE_RETURNED'), 1,
  'The Scheduler is notified their schedule was returned');
select ok((select message from notifications
           where account_id = '00000000-0000-0000-0000-00000000000d' and type = 'SCHEDULE_RETURNED') like '%Fix the time%',
  'The return comment is included in the message');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select submit_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
reset role;
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000b', 'REQUEST_SCHEDULED'), 1,
  'Juan is notified his request was scheduled');
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000c', 'REQUEST_SCHEDULED'), 1,
  'So is Maria');
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000e', 'TRIP_PUBLISHED'), 1,
  'The assigned Driver is notified the trip was published');
select is(pg_temp.count_for('00000000-0000-0000-0000-000000000010', 'TRIP_PUBLISHED'), 0,
  'The other Driver is not notified');

insert into ids values ('s2', pg_temp.publish('V2', array['port'], pg_temp.legs('d2', array['port_rd'], '10:00', '11:00', '11:30', '12:30')));

-- request_cancellation notifies every Admin --------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select request_cancellation(pg_temp.id('juan'), 'No longer needed');
reset role;
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000a', 'CANCELLATION_REQUESTED'), 1,
  'The first Admin is notified of the cancellation request');
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000f', 'CANCELLATION_REQUESTED'), 1,
  'So is the second Admin');

-- decline_cancellation notifies the Requester ------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select decline_cancellation(pg_temp.pending('juan'), 'Driver already notified');
reset role;
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000b', 'CANCELLATION_DECLINED'), 1,
  'Juan is notified his cancellation request was declined');
select ok((select message from notifications
           where account_id = '00000000-0000-0000-0000-00000000000b' and type = 'CANCELLATION_DECLINED') like '%Driver already notified%',
  'The decline note is included in the message');

-- confirm_cancellation on a shared stop: the cancelled Requester gets
-- REQUEST_CANCELLED; the other still-active Requester on the same schedule
-- is not yet notified, since the schedule is not cancelled with it --------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select request_cancellation(pg_temp.id('maria'), 'Trip moved');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select confirm_cancellation(pg_temp.pending('maria'));
reset role;
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000c', 'REQUEST_CANCELLED'), 1,
  'Maria is notified her request was cancelled');
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000b', 'REQUEST_RETURNED'), 0,
  'Juan is not notified: his request is still active on the schedule');

-- confirm_cancellation on the only request cancels the whole schedule -----
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select request_cancellation(pg_temp.id('port'), 'Not needed');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select confirm_cancellation(pg_temp.pending('port'));
reset role;
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000c', 'REQUEST_CANCELLED'), 2,
  'Maria now has two REQUEST_CANCELLED notifications, one per cancelled request');

-- cancel_schedule (direct Admin cancel, no pending cancellation) notifies
-- each released Requester --------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
insert into ids select 'solo', id from create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d2","purposeId":"p1"}]');
reset role;
insert into ids select 'solo_rd', (select id from request_destinations where request_id = pg_temp.id('solo') and active);
insert into ids values ('s3', pg_temp.publish('V2', array['solo'], pg_temp.legs('d2', array['solo_rd'], '13:00', '14:00', '14:30', '15:30')));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select cancel_schedule(pg_temp.id('s3'), 'Vehicle in the garage');
reset role;
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000b', 'REQUEST_RETURNED'), 1,
  'Juan (owner of "solo") is notified his request needs a new schedule');

-- report_problem notifies every Admin --------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-000000000010');
select throws_ok($$ select report_problem(pg_temp.id('s1'), 'Flat tire') $$, 'P0002', null,
  'The unassigned Driver cannot report a problem on this schedule');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select report_problem(pg_temp.id('s1'), 'Flat tire');
reset role;
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000a', 'PROBLEM_REPORTED'), 1,
  'The first Admin is notified of the reported problem');
select is(pg_temp.count_for('00000000-0000-0000-0000-00000000000f', 'PROBLEM_REPORTED'), 1,
  'So is the second Admin');

-- RLS isolation and mark-read -----------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from notifications where account_id <> '00000000-0000-0000-0000-00000000000b'), 0,
  'A Requester only ever sees their own notifications through RLS');
select ok((select count(*)::int from notifications) > 0, 'The Requester does see their own rows');
select throws_ok(
  $$ select mark_notification_read('00000000-0000-0000-0000-000000000099') $$,
  'P0002', null, 'Marking a nonexistent (or invisible-under-RLS) notification id fails');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from notifications where account_id = '00000000-0000-0000-0000-00000000000a' and read_at is not null), 0,
  'None of the Admin''s notifications are read yet');
select mark_notification_read((select id from notifications where account_id = '00000000-0000-0000-0000-00000000000a' limit 1));
select is((select count(*)::int from notifications where account_id = '00000000-0000-0000-0000-00000000000a' and read_at is not null), 1,
  'Marking one as read only affects that one');
select mark_all_notifications_read();
select is((select count(*)::int from notifications where account_id = '00000000-0000-0000-0000-00000000000a' and read_at is null), 0,
  'Marking all as read clears every remaining unread notification for this account');
reset role;

select * from finish();
rollback;

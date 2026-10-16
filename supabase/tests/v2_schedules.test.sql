-- v2 schedules: creation gate, shared stops, reservations, locks, stale
-- edits, approval/revision lifecycle, visibility, draft discard, history.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'juan@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'maria@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-000000000010', 'driver2@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
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
  ('purposes', 'p1', 'Inspection', 'Active'),
  ('purposes', 'p2', 'Document delivery', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date + 10;
$$;

-- Juan: City Hall / Inspection. Maria: City Hall / Document delivery, and a
-- second request for the Port Office. All on the same date.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p2"}]', null);
select create_request(pg_temp.d(), 'REGULAR', null, null, '[{"destinationId":"d2","purposeId":"p1"}]', null);
reset role;

create temp table ids (k text primary key, v uuid);
insert into ids
  select 'juan', id from requests where owner_account_id = '00000000-0000-0000-0000-00000000000b'
  union all
  select 'maria', r.id from requests r join request_destinations rd on rd.request_id = r.id
    where r.owner_account_id = '00000000-0000-0000-0000-00000000000c' and rd.destination_id = 'd1'
  union all
  select 'maria_port', r.id from requests r join request_destinations rd on rd.request_id = r.id
    where r.owner_account_id = '00000000-0000-0000-0000-00000000000c' and rd.destination_id = 'd2';
insert into ids select k || '_rd', (select id from request_destinations where request_id = v and active) from ids;
grant select on ids to authenticated;

create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.rv(p_schedule uuid) returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = p_schedule and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
-- One shared City Hall stop for Juan and Maria, then back to ANONANG.
create function pg_temp.shared_legs(p_out text, p_in text, p_back_out text, p_back_in text)
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', p_out, 'plannedTimeIn', p_in,
      'stops', jsonb_build_array(pg_temp.id('juan_rd'), pg_temp.id('maria_rd'))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', p_back_out, 'plannedTimeIn', p_back_in));
$$;
create function pg_temp.port_legs(p_out text, p_in text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', p_out, 'plannedTimeIn', p_in,
      'stops', jsonb_build_array(pg_temp.id('maria_port_rd'))));
$$;

-- Only Scheduler creates schedules, plus Admin as a Scheduler override -----
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V1', array[pg_temp.id('juan')], '[]') $$,
  'Admin can create a schedule too, acting as Scheduler (view-as override)');
select ok(
  (select is_admin_override from audit_events
   where table_name = 'schedules' and action = 'schedule.save'
   order by id desc limit 1),
  'The Admin-created schedule is audited with is_admin_override');
-- Free the request the override above just consumed, via the matching
-- Admin-as-Scheduler discard, so the fixtures below still start clean.
select discard_schedule_draft(
  (select schedule_id from schedule_requests where request_id = pg_temp.id('juan') and active),
  (select sr.row_version from schedule_revisions sr
     join schedule_requests sq on sq.schedule_id = sr.schedule_id
     where sq.request_id = pg_temp.id('juan') and sq.active));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V1', array[pg_temp.id('juan')], '[]') $$,
  '42501', null, 'Requester cannot create a schedule');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V1', array[pg_temp.id('juan')], '[]') $$,
  '42501', null, 'Driver cannot create a schedule');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok(
  $$ insert into schedules (schedule_date, created_by_account_id) values (pg_temp.d(), '00000000-0000-0000-0000-00000000000d') $$,
  '42501', null, 'Direct INSERT on schedules is denied, even for Scheduler');
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V1', array[pg_temp.id('juan')],
       (select jsonb_agg(jsonb_build_object('destinationId', 'd1',
          'plannedTimeOut', format('%s:00', lpad((6 + n)::text, 2, '0')),
          'plannedTimeIn', format('%s:30', lpad((6 + n)::text, 2, '0'))) order by n)
        from generate_series(1, 8) as n)
       || jsonb_build_array(jsonb_build_object('isFinal', true, 'plannedTimeOut', '16:00', 'plannedTimeIn', '17:00'))) $$,
  '22023', 'A schedule can have at most 8 legs, including the final leg back to ANONANG',
  'A ninth leg is refused: the printed Daily Vehicle Record has 8 rows');

-- Draft with a shared stop ---------------------------------------------------
select lives_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V1',
       array[pg_temp.id('juan'), pg_temp.id('maria')], pg_temp.shared_legs('08:00', '09:00', '09:30', '10:30')) $$,
  'Scheduler saves a draft serving two requests from one shared stop');
reset role;
insert into ids select 's1', schedule_id from schedule_requests where request_id = pg_temp.id('juan') and active;

select results_eq(
  $$ select origin, destination_name from schedule_legs l join schedule_revisions r on r.id = l.revision_id
     where r.schedule_id = pg_temp.id('s1') order by leg_no $$,
  $$ values ('ANONANG', 'City Hall'), ('City Hall', 'ANONANG') $$,
  'Origins are derived: ANONANG first, then each previous destination');
select results_eq(
  $$ select rd.purpose_name from leg_stops ls join request_destinations rd on rd.id = ls.request_destination_id
     join schedule_revisions r on r.id = ls.revision_id where r.schedule_id = pg_temp.id('s1') order by 1 $$,
  $$ values ('Document delivery'), ('Inspection') $$,
  'The shared stop keeps both requests and both purposes');
select is(
  (select period from schedule_reservations where schedule_id = pg_temp.id('s1')),
  tstzrange((pg_temp.d() + time '08:00') at time zone 'Asia/Manila',
            (pg_temp.d() + time '10:30') at time zone 'Asia/Manila', '[)'),
  'The draft reserves the vehicle from first Time Out to last Time In, to the minute');
select is(
  (select count(*)::int from schedule_requests where schedule_id = pg_temp.id('s1') and active), 2,
  'Both requests are locked into the draft');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select progress from request_progress where request_id = pg_temp.id('juan')), 'SCHEDULING',
  'Requester sees SCHEDULING progress without seeing the draft itself');
select throws_ok(
  $$ select update_request(pg_temp.id('juan'), 1, pg_temp.d(), 'REGULAR', null, null,
       '[{"destinationId":"d2","purposeId":"p1"}]', null) $$,
  '22023', null, 'An included request can no longer be edited by its owner');

-- Conflicts ------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V1', array[pg_temp.id('maria_port')],
       pg_temp.port_legs('10:00', '11:00')) $$,
  '23P01', null, 'Overlapping reservation on the same vehicle is rejected');
select throws_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V2', array[pg_temp.id('juan')],
       '[]') $$,
  '23505', null, 'A request already in one schedule cannot be put in another');
select lives_ok(
  $$ select save_schedule_draft(null, null, pg_temp.d(), 'V2', array[pg_temp.id('maria_port')],
       pg_temp.port_legs('10:00', '11:00')) $$,
  'A different vehicle and Driver at the same time is fine');
reset role;
insert into ids select 's2', schedule_id from schedule_requests where request_id = pg_temp.id('maria_port') and active;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok(
  $$ select save_schedule_draft(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')) - 1, null, 'V1',
       array[pg_temp.id('juan'), pg_temp.id('maria')], pg_temp.shared_legs('08:00', '09:00', '09:30', '10:30')) $$,
  'PT409', null, 'A stale Scheduler save is rejected instead of overwriting');
select throws_ok(
  $$ select submit_schedule(pg_temp.id('s2'), pg_temp.rv(pg_temp.id('s2'))) $$,
  '22023', null, 'A route without the final ANONANG leg cannot be submitted');

-- Submit, return, approve ------------------------------------------------------
select lives_ok(
  $$ select submit_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$,
  'Scheduler submits the draft for approval');
select throws_ok(
  $$ select save_schedule_draft(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')), null, 'V1',
       array[pg_temp.id('juan'), pg_temp.id('maria')], pg_temp.shared_legs('08:00', '09:00', '09:30', '10:30')) $$,
  '22023', null, 'Scheduler cannot edit while it waits for approval');
select throws_ok(
  $$ select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$,
  '42501', null, 'Scheduler cannot approve');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select is((select count(*)::int from schedules), 0, 'Driver cannot see an unapproved schedule');
select is((select count(*)::int from schedule_legs), 0, 'Driver cannot see draft legs');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from schedules), 0, 'Requester cannot see an unapproved schedule');
select is((select progress from request_progress where request_id = pg_temp.id('juan')), 'PENDING_APPROVAL',
  'Progress moves to PENDING_APPROVAL on submission');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok(
  $$ select return_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')), '  ') $$,
  '22023', null, 'Returning needs a comment');
select lives_ok(
  $$ select return_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')), 'Leave 15 minutes later') $$,
  'Admin returns the schedule with a comment');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok(
  $$ select save_schedule_draft(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')), null, 'V1',
       array[pg_temp.id('juan'), pg_temp.id('maria')], pg_temp.shared_legs('08:15', '09:15', '09:45', '10:45')) $$,
  'Scheduler edits the returned schedule');
select lives_ok(
  $$ select submit_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$,
  'Scheduler resubmits');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))) $$,
  'Admin approves; the schedule is published');

-- Visibility after publication ----------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select is((select count(*)::int from schedule_legs), 2, 'Driver sees the approved route');
select is((select count(*)::int from requests), 2, 'Driver sees both requesters on the route');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from schedules), 1, 'Requester sees the approved schedule serving them');
select is((select count(*)::int from leg_stops), 1, 'Requester sees only their own stop, not the other requester''s');
select is((select count(*)::int from requests where owner_account_id <> '00000000-0000-0000-0000-00000000000b'), 0,
  'Requester cannot see the other requester''s request');
select is((select progress from request_progress where request_id = pg_temp.id('juan')), 'APPROVED',
  'Progress is APPROVED once published');

-- Revision: the published version stays in force until the new one is approved
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok(
  $$ select save_schedule_draft(pg_temp.id('s1'), null, null, 'V1',
       array[pg_temp.id('juan'), pg_temp.id('maria')], pg_temp.shared_legs('13:00', '14:00', '14:30', '15:30')) $$,
  'Scheduler starts a proposed revision of the approved schedule');
select is((select count(*)::int from schedule_reservations where schedule_id = pg_temp.id('s1')), 2,
  'The published reservation is kept while the proposal waits, without conflicting with it');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select is((select min(planned_time_out) from schedule_legs), '08:15'::time,
  'Driver still sees only the published times, never the proposal');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select submit_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
reset role;
select results_eq(
  $$ select version, status from schedule_revisions where schedule_id = pg_temp.id('s1') order by version $$,
  $$ values (1, 'SUPERSEDED'), (2, 'APPROVED') $$,
  'Approving the revision supersedes the old version');
select is(
  (select lower(period) from schedule_reservations where schedule_id = pg_temp.id('s1')),
  (pg_temp.d() + time '13:00') at time zone 'Asia/Manila',
  'Reservations are replaced together with the version');
select is(
  (select min(planned_time_out) from schedule_legs l join schedule_revisions r on r.id = l.revision_id
   where r.schedule_id = pg_temp.id('s1') and r.version = 1),
  '08:15'::time, 'The superseded version''s route survives as history');
select throws_ok(
  $$ update schedule_legs set planned_time_out = '07:00' where revision_id =
       (select id from schedule_revisions where schedule_id = pg_temp.id('s1') and version = 1) $$,
  '22023', null, 'Closed versions cannot be changed, even by the owner role');

-- Discarding an unused draft frees and unlocks ------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok(
  $$ select discard_schedule_draft(pg_temp.id('s2'), pg_temp.rv(pg_temp.id('s2'))) $$,
  'Scheduler discards the unused draft');
reset role;
select ok(
  not exists (select 1 from schedule_reservations where schedule_id = pg_temp.id('s2'))
  and not exists (select 1 from schedule_requests where request_id = pg_temp.id('maria_port') and active),
  'Discarding frees the reservation and unlocks the request');
select is((select progress from request_progress where request_id = pg_temp.id('maria_port')), 'NOT_YET_SCHEDULED',
  'A discarded draft''s request is back to NOT_YET_SCHEDULED');

-- A submitted completion blocks further revisions ----------------------------
insert into trip_completions (schedule_id, revision_id, driver_id, start_odometer, end_odometer)
select id, published_revision_id, '00000000-0000-0000-0000-00000000000e', 100, 150
from schedules where id = pg_temp.id('s1');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok(
  $$ select save_schedule_draft(pg_temp.id('s1'), null, null, 'V1',
       array[pg_temp.id('juan'), pg_temp.id('maria')], pg_temp.shared_legs('16:00', '17:00', '17:30', '18:30')) $$,
  '22023', null, 'No revisions once the Driver has submitted completion');
select is((select progress from request_progress where request_id = pg_temp.id('juan')), 'COMPLETED',
  'Progress is COMPLETED after the Driver submits');

-- Renaming a plate carries schedule history with it --------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select rename_vehicle('V1', 'V1-NEW', 'Van 1', 'Active', '00000000-0000-0000-0000-00000000000e') $$,
  'Admin renames a vehicle that has approved and superseded schedule versions');
reset role;
select is(
  (select count(*)::int from schedule_revisions where schedule_id = pg_temp.id('s1') and plate = 'V1-NEW'), 2,
  'Every schedule version follows the new plate');

-- A past-date Admin request can still be scheduled and approved ------------
-- (Driver completion of the same trip is added here in Phase 8.)
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select create_request((now() at time zone 'Asia/Manila')::date - 3, 'REGULAR', null, null,
       '[{"destinationId":"d2","purposeId":"p2"}]', null) $$,
  'Admin requests transport for a trip that already happened');
reset role;
insert into ids
  select 'past', id from requests where owner_account_id = '00000000-0000-0000-0000-00000000000a';
insert into ids
  select 'past_rd', id from request_destinations where request_id = pg_temp.id('past') and active;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok(
  $$ select save_schedule_draft(null, null, (now() at time zone 'Asia/Manila')::date - 3, 'V2',
       array[pg_temp.id('past')],
       jsonb_build_array(
         jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00',
           'stops', jsonb_build_array(pg_temp.id('past_rd'))),
         jsonb_build_object('isFinal', true, 'plannedTimeOut', '09:30', 'plannedTimeIn', '10:30'))) $$,
  'Scheduler drafts a schedule on the past date');
reset role;
insert into ids select 'past_s', schedule_id from schedule_requests where request_id = pg_temp.id('past') and active;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok(
  $$ select submit_schedule(pg_temp.id('past_s'), pg_temp.rv(pg_temp.id('past_s'))) $$,
  'Scheduler submits the past-date schedule');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select approve_schedule(pg_temp.id('past_s'), pg_temp.rv(pg_temp.id('past_s'))) $$,
  'Admin approves the past-date schedule');
select is((select progress from request_progress where request_id = pg_temp.id('past')), 'APPROVED',
  'The past-date request reaches APPROVED');
select ok(
  (select (created_at at time zone 'Asia/Manila')::date > requested_date from requests where id = pg_temp.id('past')),
  'The request keeps its real entry time, not the trip date');

select * from finish();
rollback;

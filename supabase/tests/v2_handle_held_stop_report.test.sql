-- A stop report can't be marked handled while it holds the trip (0083): it
-- closes with its answer on Scheduling instead. Once answered it can be, and
-- whole-trip problems are handled as before.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000083a1', 'admin83@test.local'),
  ('00000000-0000-0000-0000-0000000083a2', 'sched83@test.local'),
  ('00000000-0000-0000-0000-0000000083a3', 'driver83@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000083a1', 'admin83', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-0000000083a2', 'sched83', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000083a3', 'driver83', 'Dan Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values ('V83', 'Van 83', '00000000-0000-0000-0000-0000000083a3');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd83a', 'Wilcon Depot', 'Active'),
  ('destinations', 'd83b', 'City Hall Annex', 'Active'),
  ('purposes', 'p83', 'Delivery', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.leg(p_no int) returns uuid language sql as $$
  select l.id from schedule_legs l join schedules s on s.published_revision_id = l.revision_id
  where s.id = pg_temp.id('s') and l.leg_no = p_no;
$$;
create function pg_temp.rv() returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = pg_temp.id('s') and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
create function pg_temp.held() returns boolean language sql as $$
  select paused_at is not null from schedules where id = pg_temp.id('s');
$$;

-- Dan (V83), today: ANONANG -> Wilcon Depot -> City Hall Annex -> ANONANG, started.
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a1');
insert into ids select 'r', id from create_request(pg_temp.today(), 'URGENT', null, null,
  '[{"destinationId":"d83a","purposeId":"p83"},{"destinationId":"d83b","purposeId":"p83"}]', null);
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a2');
insert into ids select 's', schedule_id from save_schedule_draft(null, null, pg_temp.today(), 'V83',
  array[pg_temp.id('r')], (select jsonb_build_array(
    jsonb_build_object('destinationId', 'd83a', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00', 'stops', jsonb_build_array(
      (select id from request_destinations where request_id = pg_temp.id('r') and position = 1))),
    jsonb_build_object('destinationId', 'd83b', 'plannedTimeOut', '10:00', 'plannedTimeIn', '11:00', 'stops', jsonb_build_array(
      (select id from request_destinations where request_id = pg_temp.id('r') and position = 2))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '12:00', 'plannedTimeIn', '13:00'))));
select submit_schedule(pg_temp.id('s'), pg_temp.rv());
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a1');
select approve_schedule(pg_temp.id('s'), pg_temp.rv());
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a3');
select record_trip_attendance(pg_temp.id('s'), 'START');

-- Unanswered: refused, and the trip stays held ------------------------------
insert into ids select 'p1', id from report_stop(pg_temp.id('s'), pg_temp.leg(1), 'NOT_AVAILABLE', 'Plywood isn''t in yet');
select ok(pg_temp.held(), 'the report holds the trip');

select pg_temp.act_as('00000000-0000-0000-0000-0000000083a1');
select throws_ok($$ select handle_problem(pg_temp.id('p1'), 'Called the supplier') $$,
  '22023', 'Answer this report on Scheduling first: the trip is held until it''s answered',
  'An Admin can''t mark an unanswered stop report handled');
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a2');
select throws_ok($$ select handle_problem(pg_temp.id('p1'), 'Seen on Scheduling') $$,
  '22023', null, 'Nor can a Scheduler');
reset role;
select is((select status from problem_reports where id = pg_temp.id('p1')), 'OPEN', 'it stays open for the answer');
select ok(pg_temp.held(), 'and the trip stays held');

-- Waiting on a route change: still refused ------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a2');
select answer_stop_report(pg_temp.id('p1'), 'CHANGE');
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a1');
select throws_ok($$ select handle_problem(pg_temp.id('p1'), 'Called the supplier') $$,
  '22023', null, 'Refused while the route change waits for approval');

-- Answered: closed by the answer, and the hold lifts -----------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a2');
select answer_stop_report(pg_temp.id('p1'), 'WAIT');
reset role;
select ok(not pg_temp.held(), 'answering lifts the hold');
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a1');
select is((handle_problem(pg_temp.id('p1'), 'Called the supplier')).handling_note, 'Told to wait',
  'an answered report is already handled; repeating returns it');

-- A whole-trip problem is handled as before ------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a3');
insert into ids select 'p2', id from report_problem(pg_temp.id('s'), 'Side mirror cracked');
select pg_temp.act_as('00000000-0000-0000-0000-0000000083a1');
select is((handle_problem(pg_temp.id('p2'), 'Sent to the shop')).status, 'HANDLED', 'an Admin handles a whole-trip problem');
reset role;
select ok(not pg_temp.held(), 'which never holds the trip');

select * from finish();
rollback;

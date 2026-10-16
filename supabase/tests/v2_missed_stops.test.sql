-- Missed stops (0063): the Scheduler takes a missed stop's request off a
-- trip on the road to plan it again or send it back, off draft changes too;
-- the missed leg stays with no stops and can't change; and a Scheduler marks
-- other stop reports handled. Since 0065 a missed stop, or one whose day
-- has passed, can move to any day from today.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'req1@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver1', 'Dan Driver', 'Driver'),
  ('00000000-0000-0000-0000-0000000000b1', 'req1', 'Rita Requester', 'Requester');
insert into vehicles (plate, name, assigned_driver_id) values ('V1', 'Van 1', '00000000-0000-0000-0000-00000000000e');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd1', 'City Hall', 'Active'),
  ('destinations', 'd2', 'Market', 'Active'),
  ('purposes', 'p1', 'Inspection', 'Active');

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
  where s.id = pg_temp.id('s1') and l.leg_no = p_no;
$$;
create function pg_temp.rv() returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = pg_temp.id('s1') and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
create function pg_temp.open_revision() returns uuid language sql as $$
  select id from schedule_revisions where schedule_id = pg_temp.id('s1') and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
-- The route with City Hall at p_first_in, serving p_city_hall_stops there.
create function pg_temp.route(p_first_in text, p_city_hall_stops jsonb) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('id', pg_temp.leg(1), 'destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', p_first_in,
      'stops', p_city_hall_stops),
    jsonb_build_object('id', pg_temp.leg(2), 'destinationId', 'd2', 'plannedTimeOut', '10:00', 'plannedTimeIn', '11:00',
      'stops', jsonb_build_array(pg_temp.id('r2_d'))),
    jsonb_build_object('id', pg_temp.leg(3), 'isFinal', true, 'plannedTimeOut', '12:00', 'plannedTimeIn', '13:00'));
$$;

-- r1 City Hall and r2 Market, one stop each, by req1.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
insert into ids select 'r1', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]', null);
insert into ids select 'r2', id from create_request(pg_temp.today(), 'URGENT', null, null, '[{"destinationId":"d2","purposeId":"p1"}]', null);
reset role;
insert into ids select 'r1_d', id from request_destinations where request_id = pg_temp.id('r1');
insert into ids select 'r2_d', id from request_destinations where request_id = pg_temp.id('r2');

-- s1: Dan (V1), today: ANONANG -> City Hall -> Market -> ANONANG, on the road.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
insert into ids select 's1', schedule_id from save_schedule_draft(null, null, pg_temp.today(), 'V1',
  array[pg_temp.id('r1'), pg_temp.id('r2')], jsonb_build_array(
    jsonb_build_object('destinationId', 'd1', 'plannedTimeOut', '08:00', 'plannedTimeIn', '09:00', 'stops', jsonb_build_array(pg_temp.id('r1_d'))),
    jsonb_build_object('destinationId', 'd2', 'plannedTimeOut', '10:00', 'plannedTimeIn', '11:00', 'stops', jsonb_build_array(pg_temp.id('r2_d'))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', '12:00', 'plannedTimeIn', '13:00')));
select submit_schedule(pg_temp.id('s1'), pg_temp.rv());
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select approve_schedule(pg_temp.id('s1'), pg_temp.rv());
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select record_trip_attendance(pg_temp.id('s1'), 'START');
insert into ids select 'missed', id from report_stop(pg_temp.id('s1'), pg_temp.leg(1), 'NOT_AVAILABLE', 'Gate locked');
insert into ids select 'waiting', id from report_stop(pg_temp.id('s1'), pg_temp.leg(2), 'ROAD_BLOCKED', 'Flooded', false);
insert into ids values ('leg1', pg_temp.leg(1));

-- Draft changes opened before the Scheduler sees the report.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select save_schedule_draft(pg_temp.id('s1'), null, null, 'V1', array[pg_temp.id('r1'), pg_temp.id('r2')],
  pg_temp.route('09:00', jsonb_build_array(pg_temp.id('r1_d'))));

-- Who may, and which report ------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok($$ select release_missed_stop(pg_temp.id('missed')) $$, '42501', null, 'The Driver doesn''t plan stops');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select release_missed_stop(pg_temp.id('waiting')) $$, '22023', 'Only a missed stop can be planned again',
  'A stop that wasn''t missed stays on the trip');

-- Plan it again ------------------------------------------------------------------------
select lives_ok($$ select release_missed_stop(pg_temp.id('missed')) $$, 'The Scheduler takes City Hall''s request off the trip');
reset role;
select ok(not exists (select 1 from schedule_requests where request_id = pg_temp.id('r1') and active), 'City Hall''s request is waiting again');
select ok((select active from schedule_requests where request_id = pg_temp.id('r2')), 'The Market''s stays on the trip');
select is(pg_temp.leg(1), pg_temp.id('leg1'), 'The missed leg stays on the route');
select is((select count(*)::int from leg_stops where leg_id = pg_temp.id('leg1')), 0, 'with no stops');
select ok(not exists (select 1 from revision_requests where revision_id = pg_temp.open_revision() and request_id = pg_temp.id('r1')),
  'and it''s off the draft changes too');
select is((select status || ': ' || handling_note from problem_reports where id = pg_temp.id('missed')), 'HANDLED: Planned again',
  'The report is handled');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select release_missed_stop(pg_temp.id('missed')) $$, '22023', 'This missed stop was already handled. Reload and try again',
  'Only once');

-- Another day (0065) --------------------------------------------------------------------
reset role;
select ok((select missed_at is not null from requests where id = pg_temp.id('r1')), 'City Hall''s request is marked missed');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select move_request_day(pg_temp.id('r1'), pg_temp.today() - 1) $$, '22023', 'That day has passed',
  'Not to a day that has passed');
select lives_ok($$ select move_request_day(pg_temp.id('r1'), pg_temp.today() + 10) $$,
  'The Scheduler moves the missed stop to any later day, not just its week');
reset role;
select is((select requested_date from requests where id = pg_temp.id('r1')), pg_temp.today() + 10, 'It''s on the new day');
select is((select count(*)::int from notifications where type = 'REQUEST_MOVED' and account_id = '00000000-0000-0000-0000-0000000000b1'
  and message like 'Your stop was missed on %'), 1, 'and the requester is told it was missed');

-- r3: waiting, asked for yesterday; r4: waiting, asked for today.
insert into requests (owner_account_id, owner_name, requested_date, request_type, status, flexibility)
values ('00000000-0000-0000-0000-0000000000b1', 'Rita Requester', pg_temp.today() - 1, 'REGULAR', 'ACTIVE', 'DAY'),
       ('00000000-0000-0000-0000-0000000000b1', 'Rita Requester', pg_temp.today(), 'REGULAR', 'ACTIVE', 'DAY');
insert into ids select 'r3', id from requests where requested_date = pg_temp.today() - 1;
insert into ids select 'r4', id from requests where requested_date = pg_temp.today() and id not in (pg_temp.id('r1'), pg_temp.id('r2'));
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok($$ select move_request_day(pg_temp.id('r3'), pg_temp.today()) $$, 'A stop whose day passed can move to today');
select throws_ok($$ select move_request_day(pg_temp.id('r4'), pg_temp.today() + 1) $$, '22023',
  'Only a stop the requester marked "Any day that week", a missed stop, or one whose day has passed can be moved',
  'A stop for today that wasn''t missed still can''t');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$ select move_request_day(pg_temp.id('r3'), pg_temp.today() + 2) $$, '42501', null,
  'Only a Scheduler moves stops');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');

-- The missed leg with no stops in later changes ---------------------------------------
select lives_ok($$ select save_schedule_draft(pg_temp.id('s1'), pg_temp.rv(), null, 'V1', array[pg_temp.id('r2')],
  pg_temp.route('09:00', '[]')) $$, 'Draft changes keep the missed leg with no stops');
reset role;
select is((select destination_name from schedule_legs where revision_id = pg_temp.open_revision() and leg_no = 1), 'City Hall',
  'where it was');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select submit_schedule(pg_temp.id('s1'), pg_temp.rv());
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select approve_schedule(pg_temp.id('s1'), pg_temp.rv()) $$, 'The Admin approves them');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select save_schedule_draft(pg_temp.id('s1'), null, null, 'V1', array[pg_temp.id('r2')], pg_temp.route('09:15', '[]'));
select submit_schedule(pg_temp.id('s1'), pg_temp.rv());
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select approve_schedule(pg_temp.id('s1'), pg_temp.rv()) $$, '22023',
  'The Driver has already reached a stop this change moves. Return it to the Scheduler to redo', 'A missed leg can''t change, like a reached one');

-- Other stop reports, and sending back -------------------------------------------------
select lives_ok($$ select handle_problem(pg_temp.id('waiting'), 'Driver waited it out') $$, 'A Scheduler marks a stop report handled');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
insert into ids select 'whole', id from report_problem(pg_temp.id('s1'), 'Aircon broke');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select handle_problem(pg_temp.id('whole'), 'Seen') $$, '42501', null, 'but not a problem with the whole trip');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
insert into ids select 'closed', id from report_stop(pg_temp.id('s1'), pg_temp.leg(2), 'WRONG_ADDRESS', 'Closed today');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select lives_ok($$ select release_missed_stop(pg_temp.id('closed'), true, 'Closed today') $$, 'The Scheduler sends the Market back');
reset role;
select is((select sent_back_reason from requests where id = pg_temp.id('r2')), 'Closed today', 'It''s sent back');
select is((select count(*)::int from notifications where type = 'REQUEST_SENT_BACK' and account_id = '00000000-0000-0000-0000-0000000000b1'), 1,
  'and the requester is told');

select * from finish();
rollback;

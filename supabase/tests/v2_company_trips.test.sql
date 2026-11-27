-- Company trips v2: the requester books the trip (0094). Sending it creates
-- the Company trip and sends it straight to the Admin; the vehicle and
-- people can't be on two trips at once; a personal vehicle is only its
-- owner's (0092); Return goes back to the requester, who resends; editing
-- an approved trip waits for the Admin while the approved one stays; the
-- requester sees all of it on My Requests (0096, 0097).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000001a1', 'rhea9@test.local'),
  ('00000000-0000-0000-0000-0000000001a2', 'gina9@test.local'),
  ('00000000-0000-0000-0000-0000000001a3', 'pat9@test.local'),
  ('00000000-0000-0000-0000-0000000001a4', 'jun9@test.local'),
  ('00000000-0000-0000-0000-0000000001a5', 'ada9@test.local');
insert into accounts (id, username, name, role, position, can_request_company, can_drive_company) values
  ('00000000-0000-0000-0000-0000000001a1', 'rhea9', 'Rhea Santos', 'Requester', 'Purchasing Officer', true, false),
  ('00000000-0000-0000-0000-0000000001a2', 'gina9', 'Gina Cruz', 'Requester', 'Engineer', true, true),
  ('00000000-0000-0000-0000-0000000001a3', 'pat9', 'Pat Lim', 'Requester', 'Engineer', false, false);
insert into accounts (id, username, name, role, driver_type) values
  ('00000000-0000-0000-0000-0000000001a4', 'jun9', 'Jun Reyes', 'Driver', 'Company car');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000001a5', 'ada9', 'Ada Admin', 'Admin');
insert into vehicles (plate, name, company_trips) values ('CT-1', 'Mirage', true);
insert into vehicles (plate, name, company_trips, owner_account_id)
  values ('PV-1', 'Vios', true, '00000000-0000-0000-0000-0000000001a2');
insert into booking_options ("group", id, name, status) values
  ('projects', 'ct-proj', 'Procurement', 'Active'),
  ('destinations', 'ct-d1', 'Wilcon Depot', 'Active'),
  ('destinations', 'ct-d2', 'Site A', 'Active'),
  ('destinations', 'ct-d3', 'Warehouse', 'Active'),
  ('urgent_reasons', 'ct-urg', 'Supplier can only meet today', 'Active')
on conflict do nothing;
insert into booking_options ("group", id, name, status) values ('starting_points', 'start-office', 'Main Office', 'Active')
on conflict ("group", id) do update set status = 'Active';

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.d() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date + 10;
$$;
-- Two stops: Time Out, 30 min to stop 1, 30 min there, then stop 2 at p_in.
create function pg_temp.trip(p_plate text, p_driver text, p_out text, p_in text, p_pass jsonb default '[]') returns jsonb language sql as $$
  select jsonb_build_object('date', pg_temp.d(), 'departmentId', 'ct-proj', 'vehiclePlate', p_plate,
    'driverId', p_driver, 'purpose', 'Pick up rebar samples', 'fleetCard', '4821', 'priority', 'REGULAR',
    'timeOut', p_out,
    'stops', jsonb_build_array(
      jsonb_build_object('destinationId', 'ct-d1', 'arriveAt', to_char(p_out::time + interval '30 min', 'HH24:MI'),
        'leaveAt', to_char(p_out::time + interval '60 min', 'HH24:MI')),
      jsonb_build_object('destinationId', 'ct-d2', 'arriveAt', p_in)),
    'passengers', p_pass);
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert, update on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.sched(p_group uuid) returns uuid language sql as $$
  select sr.schedule_id from schedule_requests sr join requests r on r.id = sr.request_id where r.group_id = p_group limit 1;
$$;
create function pg_temp.open_rev(p_schedule uuid) returns schedule_revisions language sql as $$
  select * from schedule_revisions where schedule_id = p_schedule and status = 'SUBMITTED';
$$;

-- Booking --------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
select lives_ok(
  $$insert into ids select 'r', (request_company_trip(null, null, pg_temp.trip('CT-1', '00000000-0000-0000-0000-0000000001a4', '09:00', '11:00',
      jsonb_build_array(jsonb_build_object('accountId', '00000000-0000-0000-0000-0000000001a3'), jsonb_build_object('guestName', 'Supplier rep'))))).id$$,
  'A requester books a company vehicle, a Driver, times and passengers'
);
reset role;
select is((select status from schedule_revisions where schedule_id = pg_temp.sched(pg_temp.id('r'))), 'SUBMITTED', 'Sending it goes straight to the Admin');
select is(
  (select string_agg(to_char(planned_time_out, 'HH24:MI') || '-' || to_char(planned_time_in, 'HH24:MI'), ' ' order by leg_no)
   from schedule_legs where revision_id = (select id from schedule_revisions where schedule_id = pg_temp.sched(pg_temp.id('r')))),
  '09:00-09:30 10:00-11:00',
  'The legs follow Time Out, each stop''s times and Time In'
);
select is((select origin from schedule_legs l join schedule_revisions sr on sr.id = l.revision_id
  where sr.schedule_id = pg_temp.sched(pg_temp.id('r')) and l.leg_no = 1), 'Main Office', 'It starts at the Main Office');
select is((select count(*)::int from request_group_passengers where group_id = pg_temp.id('r')), 2, 'An account and a guest ride along');
select ok(exists (select 1 from notifications where account_id = '00000000-0000-0000-0000-0000000001a5' and type = 'SCHEDULE_SUBMITTED'),
  'The Admin is told');

-- No vehicle or person on two trips at once ------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select throws_ok(
  $$select request_company_trip(null, null, pg_temp.trip('CT-1', '00000000-0000-0000-0000-0000000001a2', '10:30', '12:00'))$$,
  '23P01', null, 'The vehicle can''t be booked twice at once'
);
select throws_ok(
  $$select request_company_trip(null, null, pg_temp.trip('PV-1', null, '10:30', '12:00',
      jsonb_build_array(jsonb_build_object('accountId', '00000000-0000-0000-0000-0000000001a3'))))$$,
  '23P01', 'Pat Lim is already on another company trip from 9:00 AM to 11:00 AM', 'A passenger can''t be on two trips at once'
);
select throws_ok(
  $$select request_company_trip(null, null, pg_temp.trip('PV-1', null, '10:30', '12:00',
      jsonb_build_array(jsonb_build_object('accountId', '00000000-0000-0000-0000-0000000001a1'))))$$,
  '23P01', null, 'Nor can a requester'
);

-- Personal vehicles ---------------------------------------------------------------
select lives_ok(
  $$insert into ids select 'g', (request_company_trip(null, null, pg_temp.trip('PV-1', '00000000-0000-0000-0000-0000000001a4', '10:30', '12:00'))).id$$,
  'The owner books their own vehicle'
);
reset role;
select is((select driver_id from request_groups where id = pg_temp.id('g')), '00000000-0000-0000-0000-0000000001a2'::uuid,
  'and drives it, whoever was sent as Driver');
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
select throws_ok(
  $$select request_company_trip(null, null, pg_temp.trip('PV-1', '00000000-0000-0000-0000-0000000001a4', '13:00', '14:00'))$$,
  null, null, 'Nobody else can book a personal vehicle'
);

-- What the form must have -----------------------------------------------------------
select throws_ok(
  $$select request_company_trip(null, null, pg_temp.trip('CT-1', '00000000-0000-0000-0000-0000000001a4', '13:00', '14:00') - 'fleetCard')$$,
  '22023', 'Enter the last 4 digits of the Fleet Card', 'The Fleet Card is required'
);
select throws_ok(
  $$select request_company_trip(null, null, pg_temp.trip('CT-1', '00000000-0000-0000-0000-0000000001a4', '13:00', '14:00') || '{"priority":"URGENT"}')$$,
  null, null, 'Urgent needs a reason'
);
select throws_ok(
  $$select request_company_trip(null, null, jsonb_set(pg_temp.trip('CT-1', '00000000-0000-0000-0000-0000000001a4', '13:00', '15:00'), '{stops,0,leaveAt}', '"13:10"'))$$,
  null, null, 'Leaving a stop before arriving is refused'
);
select throws_ok(
  $$select create_request_group('COMPANY', jsonb_build_object('date', pg_temp.d(), 'stops', '[]'::jsonb))$$,
  null, null, 'The old Company request form is refused'
);
select is((select count(*)::int from company_trip_busy(pg_temp.d())), 2, 'The form sees the day''s booked trips');

-- Return, resend, approve, edit --------------------------------------------------------
reset role;
insert into ids values ('s', pg_temp.sched(pg_temp.id('r')));
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a5');
select return_schedule(pg_temp.id('s'), (pg_temp.open_rev(pg_temp.id('s'))).row_version, 'Add the warehouse stop');
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
select results_eq(
  $$select state, comment from my_company_trips(null)$$,
  $$values ('RETURNED', 'Add the warehouse stop')$$,
  'Return goes back to the requester with the comment'
);
select lives_ok(
  $$select request_company_trip(pg_temp.id('r'), (select row_version from request_groups where id = pg_temp.id('r')),
      pg_temp.trip('CT-1', '00000000-0000-0000-0000-0000000001a4', '09:00', '11:30') || jsonb_build_object(
        'priority', 'URGENT', 'urgentReasonId', 'ct-urg',
        'stops', jsonb_build_array(
          jsonb_build_object('destinationId', 'ct-d1', 'arriveAt', '09:30', 'leaveAt', '10:00'),
          jsonb_build_object('destinationId', 'ct-d3', 'arriveAt', '10:20', 'leaveAt', '10:40'),
          jsonb_build_object('destinationId', 'ct-d2', 'arriveAt', '11:30'))))$$,
  'The requester edits it (a third stop, Urgent) and resends it'
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a5');
select approve_schedule(pg_temp.id('s'), (pg_temp.open_rev(pg_temp.id('s'))).row_version);
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
select request_company_trip(pg_temp.id('r'), (select row_version from request_groups where id = pg_temp.id('r')),
  pg_temp.trip('CT-1', '00000000-0000-0000-0000-0000000001a4', '08:30', '11:00'));
select results_eq(
  $$select state, jsonb_array_length(legs) from my_company_trips(null) where group_id = pg_temp.id('r')$$,
  $$values ('CHANGES_WAITING', 2)$$,
  'Editing an approved trip waits for the Admin'
);
reset role;
select is((select sr.status from schedule_revisions sr join schedules s on s.published_revision_id = sr.id where s.id = pg_temp.id('s')),
  'APPROVED', 'and the approved version stays in force until then');
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a1');
select throws_ok(
  $$select request_company_trip(pg_temp.id('r'), (select row_version from request_groups where id = pg_temp.id('r')),
      pg_temp.trip('CT-1', '00000000-0000-0000-0000-0000000001a4', '08:30', '11:00') || jsonb_build_object('date', pg_temp.d() + 1))$$,
  '22023', null, 'An approved trip''s date can''t change'
);

-- Cancel ---------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a2');
select cancel_company_trip(pg_temp.id('g'), 'Not needed');
reset role;
select results_eq(
  $$select s.status, (select count(*)::int from requests r where r.group_id = pg_temp.id('g') and r.status = 'ACTIVE')
    from schedules s where s.id = pg_temp.sched(pg_temp.id('g'))$$,
  $$values ('CANCELLED', 0)$$,
  'The requester cancels their trip and its stops'
);

select * from finish();
rollback;

-- v2 requests: role gates, date rules, snapshots, edit lock, RLS, audit.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'req1@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'req2@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'sched@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'driver@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-00000000000b', 'req1', 'Juan Requester', 'Requester'),
  ('00000000-0000-0000-0000-00000000000c', 'req2', 'Maria Requester', 'Requester'),
  ('00000000-0000-0000-0000-00000000000d', 'sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-00000000000e', 'driver', 'Dan Driver', 'Driver');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd1', 'City Hall', 'Active'),
  ('destinations', 'd2', 'Port Office', 'Active'),
  ('destinations', 'd3', 'Closed Site', 'Inactive'),
  ('purposes', 'p1', 'Inspection', 'Active'),
  ('purposes', 'p2', 'Document delivery', 'Active'),
  ('projects', 'pr1', 'Harbor Project', 'Active'),
  ('projects', 'pr2', 'Old Project', 'Active'),
  ('destinations', 'd4', 'Warehouse', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create function pg_temp.today() returns date language sql as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

-- Role gates ---------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select create_request(pg_temp.today() + 7, 'REGULAR', 'pr1', null,
       '[{"destinationId":"d1","purposeId":"p1"},{"destinationId":"d2","purposeId":"p2"}]') $$,
  'Requester creates a Regular request 7 days ahead with two destinations');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select throws_ok(
  $$ select create_request(pg_temp.today() + 7, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  '42501', null, 'Driver cannot create requests');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select throws_ok(
  $$ select create_request(pg_temp.today() + 7, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  '42501', null, 'Scheduler cannot create requests');

reset role;
select throws_ok(
  $$ update accounts set role = 'Booker' where id = '00000000-0000-0000-0000-00000000000b' $$,
  '23514', null, 'The retired Booker role is no longer a valid account role');

-- Date rules ---------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select create_request(pg_temp.today() + 6, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  '22023', null, 'Regular 6 days ahead is rejected');
select throws_ok(
  $$ select create_request(pg_temp.today() + 7, 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  '22023', null, 'Urgent 7 days ahead is rejected (that is Regular)');
select lives_ok(
  $$ select create_request(pg_temp.today(), 'URGENT', null, 'Barangay 5 hall', '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  'Urgent today with Other project text is accepted');
select lives_ok(
  $$ select create_request(pg_temp.today() + 1, 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  'Urgent tomorrow is accepted');
select throws_ok(
  $$ select create_request(pg_temp.today() - 1, 'URGENT', null, null, '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  '22023', null, 'Requester cannot request a past date');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select create_request(pg_temp.today() - 3, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  'Admin can request a past date');

-- Options and snapshots ----------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ select create_request(pg_temp.today() + 8, 'REGULAR', null, null, '[{"destinationId":"d3","purposeId":"p1"}]') $$,
  '22023', null, 'Inactive destination is rejected');
select throws_ok(
  $$ select create_request(pg_temp.today() + 8, 'REGULAR', 'pr1', 'Other text', '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  '22023', null, 'Project option and Other text together are rejected');
select throws_ok(
  $$ select create_request(pg_temp.today() + 8, 'REGULAR', null, null, '[]') $$,
  '22023', null, 'At least one destination is required');

reset role;
update booking_options set name = 'City Hall (renamed)' where "group" = 'destinations' and id = 'd1';
select is(
  (select destination_name from request_destinations rd
     join requests r on r.id = rd.request_id
   where r.project_id = 'pr1' and rd.position = 1),
  'City Hall', 'Destination name snapshot survives an option rename');

-- Edits keep options that were deactivated after the request was made -----
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select create_request(pg_temp.today() + 10, 'REGULAR', 'pr2', null, '[{"destinationId":"d4","purposeId":"p2"}]') $$,
  'Admin creates a request using options that are still Active');

reset role;
update booking_options set status = 'Inactive' where id in ('pr2', 'd4');
update booking_options set name = 'Warehouse (old)' where id = 'd4';

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$ select update_request(
       (select id from requests where project_id = 'pr2'), 1, pg_temp.today() + 11, 'REGULAR', 'pr2', null,
       '[{"destinationId":"d4","purposeId":"p2"}]') $$,
  'An edit may keep a destination and Project / Site that are now Inactive');
select is(
  (select destination_name from request_destinations rd join requests r on r.id = rd.request_id
   where r.project_id = 'pr2' and rd.active),
  'Warehouse', 'A kept Inactive destination keeps its original name snapshot');
select is(
  (select project_name from requests where project_id = 'pr2'),
  'Old Project', 'A kept Inactive Project / Site keeps its name snapshot');
select throws_ok(
  $$ select update_request(
       (select id from requests where project_id = 'pr2'), 2, pg_temp.today() + 11, 'REGULAR', 'pr2', null,
       '[{"destinationId":"d4","purposeId":"p2"},{"destinationId":"d3","purposeId":"p1"}]') $$,
  '22023', null, 'An edit cannot newly choose an Inactive destination');

-- Edit lock and stale edits ------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select lives_ok(
  $$ select update_request(
       (select id from requests where project_id = 'pr1'), 1, pg_temp.today() + 9, 'REGULAR', 'pr1', null,
       '[{"destinationId":"d2","purposeId":"p2"}]') $$,
  'Owner edits an unscheduled request');
select throws_ok(
  $$ select update_request(
       (select id from requests where project_id = 'pr1'), 1, pg_temp.today() + 9, 'REGULAR', 'pr1', null,
       '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  'PT409', null, 'A stale form (old row_version) cannot overwrite a newer edit');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ select update_request(
       (select id from requests where owner_account_id = '00000000-0000-0000-0000-00000000000b' limit 1),
       2, pg_temp.today() + 9, 'REGULAR', null, null, '[{"destinationId":"d1","purposeId":"p1"}]') $$,
  'P0002', null, 'Another Requester cannot edit the request');

-- RLS reads ----------------------------------------------------------------
select is((select count(*)::int from requests), 0, 'Requester sees none of another Requester''s requests');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from requests), 3, 'Requester sees exactly their own requests');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select is((select count(*)::int from requests where owner_account_id::text like '00000000-0000-0000-0000-%'), 5, 'Scheduler sees the whole request pool');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000e');
select is((select count(*)::int from requests), 0, 'Driver sees no unscheduled requests');

-- Direct writes are blocked ------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select throws_ok(
  $$ update requests set requested_date = pg_temp.today() - 30 $$,
  '42501', null, 'Direct UPDATE on requests is denied');

-- Audit history ------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select ok(
  (select count(*) from audit_events where table_name = 'requests' and action = 'request.update'
     and record_id = (select id from requests where project_id = 'pr1')) = 1,
  'The edit left a labelled audit event');
reset role;
select throws_ok(
  $$ delete from audit_events $$,
  '42501', null, 'Audit history cannot be deleted, even by the owner role');

select * from finish();
rollback;

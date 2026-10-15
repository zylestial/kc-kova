-- A Scheduler can change a trip that's waiting for Admin approval (0057):
-- the version stays SUBMITTED, and the Admin can only approve the latest.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000ee00a', 'ewt-admin@test.local'),
  ('00000000-0000-0000-0000-0000000ee00d', 'ewt-sched@test.local'),
  ('00000000-0000-0000-0000-0000000ee00e', 'ewt-driver1@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000ee00a', 'ewt_admin', 'Ada Admin', 'Admin'),
  ('00000000-0000-0000-0000-0000000ee00d', 'ewt_sched', 'Sam Scheduler', 'Scheduler'),
  ('00000000-0000-0000-0000-0000000ee00e', 'ewt_driver1', 'Dan Driver', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values
  ('EWT-1', 'Van 1', '00000000-0000-0000-0000-0000000ee00e');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'ewt-d1', 'City Hall', 'Active'),
  ('purposes', 'ewt-p1', 'Inspection', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;
create function pg_temp.day() returns date language sql as $$ select (now() at time zone 'Asia/Manila')::date + 10; $$;
create function pg_temp.rv(p_schedule uuid) returns int language sql as $$
  select row_version from schedule_revisions
  where schedule_id = p_schedule and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
$$;
create function pg_temp.legs(p_out text, p_in text, p_back text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('destinationId', 'ewt-d1', 'plannedTimeOut', p_out, 'plannedTimeIn', p_in,
      'stops', jsonb_build_array(pg_temp.id('r1_rd'))),
    jsonb_build_object('isFinal', true, 'plannedTimeOut', p_in, 'plannedTimeIn', p_back));
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000ee00a');
insert into ids select 'r1', id from create_request(pg_temp.day(), 'REGULAR', null, null, '[{"destinationId":"ewt-d1","purposeId":"ewt-p1"}]', null);
reset role;
insert into ids select 'r1_rd', (select id from request_destinations where request_id = pg_temp.id('r1') and active);

select pg_temp.act_as('00000000-0000-0000-0000-0000000ee00d');
insert into ids select 's1', schedule_id from save_schedule_draft(null, null, pg_temp.day(), 'EWT-1', array[pg_temp.id('r1')],
  pg_temp.legs('08:00', '09:00', '10:00'));
select submit_schedule(pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1')));
create temp table seen (rv int);
grant select, insert on seen to authenticated;
insert into seen select pg_temp.rv(pg_temp.id('s1'));

-- Tests --------------------------------------------------------------------
select lives_ok(
  format($$ select save_schedule_draft(%L, %s, null, 'EWT-1', array[pg_temp.id('r1')], pg_temp.legs('08:30', '09:30', '10:30')) $$,
    pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))),
  'The Scheduler can change a trip waiting for Admin approval');
select is((select status from schedule_revisions where schedule_id = pg_temp.id('s1') and status <> 'DISCARDED'), 'SUBMITTED',
  'and it stays waiting for the Admin');
select is((select to_char(planned_time_out, 'HH24:MI') from schedule_legs l join schedule_revisions r on r.id = l.revision_id
  where r.schedule_id = pg_temp.id('s1') and l.leg_no = 1), '08:30',
  'with the new times');

select pg_temp.act_as('00000000-0000-0000-0000-0000000ee00a');
select throws_ok(
  format($$ select approve_schedule(%L, %s) $$, pg_temp.id('s1'), (select rv from seen)),
  '40001', null, 'The Admin can''t approve the version from before the change');
select lives_ok(
  format($$ select approve_schedule(%L, %s) $$, pg_temp.id('s1'), pg_temp.rv(pg_temp.id('s1'))),
  'but approves the latest one');

select * from finish();
rollback;

-- Moving an "any day that week" stop to another day of its week
-- (0053_move_week_stop.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ea', 'ana@test.local'),
  ('00000000-0000-0000-0000-0000000000eb', 'sam@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-0000000000ea', 'anaw', 'Ana Dizon', 'Requester'),
  ('00000000-0000-0000-0000-0000000000eb', 'samw', 'Sam W', 'Scheduler');
insert into booking_options ("group", id, name, status) values
  ('projects', 'wp', 'Riverside Townhomes', 'Active'),
  ('destinations', 'wd', 'Wilcon Depot', 'Active'),
  ('purposes', 'wv', 'Site visit', 'Active');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;
-- Next week's Monday, plus p_days.
create function pg_temp.nw(p_days int) returns date language sql as $$
  select week_monday((now() at time zone 'Asia/Manila')::date) + 7 + p_days;
$$;
create function pg_temp.stop(p_flex text, p_over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('projectId', 'wp', 'destinationId', 'wd', 'purposeId', 'wv', 'flexibility', p_flex) || p_over;
$$;
create temp table ids (k text primary key, v uuid);
grant select, insert on ids to authenticated;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k; $$;

-- Ana asks for next Wednesday: stop A any day that week, stop B any time that day.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ea');
insert into ids select 'g', (create_request_group('DAILY', jsonb_build_object('date', pg_temp.nw(2),
  'stops', jsonb_build_array(pg_temp.stop('WEEK'), pg_temp.stop('DAY'))))).id;
insert into ids select 'a', id from requests where group_id = pg_temp.id('g') and stop_letter = 'A';
insert into ids select 'b', id from requests where group_id = pg_temp.id('g') and stop_letter = 'B';

select throws_ok(
  format('select move_request_day(%L, %L)', pg_temp.id('a'), pg_temp.nw(0)),
  '42501', 'Only a Scheduler can move a stop to another day', 'A requester cannot move a stop');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000eb');
select throws_ok(
  format('select move_request_day(%L, %L)', pg_temp.id('b'), pg_temp.nw(0)),
  '22023', 'Only a stop the requester marked "Any day that week" can be moved', 'A stop for that day only stays');
select throws_ok(
  format('select move_request_day(%L, %L)', pg_temp.id('a'), pg_temp.nw(6)),
  '22023', 'Pick a day from Monday to Saturday of the week the requester asked for', 'Not to the Sunday');
select throws_ok(
  format('select move_request_day(%L, %L)', pg_temp.id('a'), pg_temp.nw(7)),
  '22023', 'Pick a day from Monday to Saturday of the week the requester asked for', 'Not to another week');
select lives_ok(
  format('select move_request_day(%L, %L)', pg_temp.id('a'), pg_temp.nw(0)), 'A Scheduler moves it to the Monday');
reset role;
select is((select requested_date from requests where id = pg_temp.id('a')), pg_temp.nw(0), 'The stop is on the Monday');
select is((select requested_date from request_groups where id = pg_temp.id('g')), pg_temp.nw(2), 'The request still says what was asked for');
select is((select count(*)::int from notifications where related_request_id = pg_temp.id('a') and type = 'REQUEST_MOVED'), 1,
  'Ana is told');

-- Ana edits the request: a moved stop keeps its day within the week, not once the request moves week
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ea');
select update_request_group(pg_temp.id('g'), 1, jsonb_build_object('date', pg_temp.nw(3), 'stops', jsonb_build_array(
  pg_temp.stop('WEEK', jsonb_build_object('id', pg_temp.id('a'), 'details', 'Gate 2')),
  pg_temp.stop('DAY', jsonb_build_object('id', pg_temp.id('b'))))));
reset role;
select is((select requested_date from requests where id = pg_temp.id('a')), pg_temp.nw(0), 'An edit in the same week keeps the moved day');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ea');
select update_request_group(pg_temp.id('g'), 2, jsonb_build_object('date', pg_temp.nw(9), 'stops', jsonb_build_array(
  pg_temp.stop('WEEK', jsonb_build_object('id', pg_temp.id('a'))),
  pg_temp.stop('DAY', jsonb_build_object('id', pg_temp.id('b'))))));
reset role;
select is((select requested_date from requests where id = pg_temp.id('a')), pg_temp.nw(9), 'Moving the request to another week takes the stop along');
select ok((select moved_at is null from requests where id = pg_temp.id('a')), 'and it is no longer marked as moved');

select * from finish();
rollback;

-- v2.5: request_progress carries requested_date so the app can load a
-- window of it (0041_request_progress_date.sql).
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000008a', 'juan8@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000008a', 'juan8', 'Juan Eight', 'Requester');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000008b', 'driver8@test.local');
insert into accounts (id, username, name, role) values
  ('00000000-0000-0000-0000-00000000008b', 'driver8', 'Dan 8', 'Driver');
insert into vehicles (plate, name, assigned_driver_id) values ('V88', 'Van 88', '00000000-0000-0000-0000-00000000008b');
insert into booking_options ("group", id, name, status) values
  ('destinations', 'd88', 'City Hall 88', 'Active'),
  ('purposes', 'p88', 'Inspection', 'Active');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000008a', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table made (id uuid, days int);
grant all on made to authenticated;
insert into made select (create_request((now() at time zone 'Asia/Manila')::date + d, case when d < 7 then 'URGENT' else 'REGULAR' end, null, null,
  '[{"destinationId":"d88","purposeId":"p88"}]', 'V88')).id, d from unnest(array[1, 20]) as d;

select is((select count(*)::int from request_progress p join made m on m.id = p.request_id), 2,
  'both new requests are in the view');
select is((select requested_date from request_progress p join made m on m.id = p.request_id where m.days = 20),
  (now() at time zone 'Asia/Manila')::date + 20, 'the view carries each request''s date');
select is((select count(*)::int from request_progress p join made m on m.id = p.request_id
  where p.requested_date >= (now() at time zone 'Asia/Manila')::date + 10), 1,
  'a date filter keeps only the later request');

select * from finish();
rollback;

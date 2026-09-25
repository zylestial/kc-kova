-- v2: the v1.2 booking objects are gone and what v2 still needs is kept.
-- Run locally with `supabase test db` (never against a hosted project).
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

select hasnt_table('public', t, t || ' is dropped')
from unnest(array['bookings', 'booking_slots', 'vehicle_records', 'vehicle_aliases']) as t;

select hasnt_function('public', f, f || ' is dropped')
from unnest(array[
  'create_booking', 'update_booking', 'cancel_booking', 'approve_booking', 'deny_booking',
  'enforce_same_daily_driver', 'block_inactive_vehicle'
]) as f;

select has_table('public', 'booking_options', 'booking_options is kept');
select has_table('public', 'people', 'people is kept');
select has_function('public', 'rename_vehicle', 'rename_vehicle is kept');
select has_table('public', 'schedule_reservations', 'schedule_reservations is kept');
select has_table('public', 'trip_completions', 'trip_completions is kept');

select * from finish();
rollback;

-- Same issue as 0004, for the `authenticated` role: Row Level Security
-- policies only ever narrow what a query can see/touch — Postgres still
-- requires an ordinary GRANT on the table before RLS policies are even
-- considered. This project's template didn't pre-seed the grants Supabase
-- normally sets up automatically, so every read in 0001_init.sql's
-- "_select" policies and every write in its "_admin_write" policies was
-- unreachable (permission denied) despite the policies themselves being
-- correct. Grant exactly what those policies expect to gate:
-- authenticated may SELECT everything the "_select" policies cover, and
-- may attempt writes on the tables the "_admin_write" policies cover (RLS
-- still restricts those writes to Admins). `bookings`, `booking_slots`, and
-- `vehicle_records` intentionally get no write grant here — those go
-- through the RPC functions (security definer, owned by the table owner)
-- or, for vehicle_records, the service-role client — see
-- docs/ARCHITECTURE.md.

grant usage on schema public to authenticated;

grant select on
  accounts, vehicles, vehicle_aliases, booking_options, people,
  bookings, vehicle_records
to authenticated;

grant insert, update, delete on
  accounts, vehicles, vehicle_aliases, booking_options, people
to authenticated;

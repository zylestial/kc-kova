-- service_role always bypasses Row Level Security (it has the BYPASSRLS
-- role attribute), but RLS bypass doesn't substitute for ordinary
-- table-level GRANTs — Postgres still checks those first. Supabase project
-- templates normally pre-seed these grants for the public schema, but that
-- isn't guaranteed across every project, and our routes rely on the
-- service-role client to write to accounts (Auth user management),
-- login_attempts, and vehicle_records (see docs/ARCHITECTURE.md). Make the
-- grants explicit so setup doesn't depend on an assumption about the
-- project template.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

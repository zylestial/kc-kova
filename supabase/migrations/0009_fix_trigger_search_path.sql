-- Fixes a regression surfaced by testing 0006_harden_definer_functions.sql
-- against a local `supabase start` instance: create_booking/update_booking
-- (search_path = '', see 0006) insert into bookings, which fires the
-- enforce_same_daily_driver and block_inactive_vehicle triggers from
-- 0001_init.sql. Those trigger functions aren't SECURITY DEFINER
-- themselves, but a trigger fired by a statement inside a function with a
-- SET search_path clause still runs under that overridden search_path for
-- the duration of the call — so their unqualified `bookings`/`vehicles`
-- references broke ("relation does not exist") as soon as 0006 shipped.
-- 0001_init.sql is already applied to production and must not be edited
-- (see CLAUDE.md), so this is a new migration rather than a fix to it.
--
-- Both trigger functions now set search_path = '' explicitly and
-- schema-qualify their table references, so they behave the same
-- regardless of which search_path the calling context happens to have —
-- the same fix already applied to every SECURITY DEFINER function.

create or replace function enforce_same_daily_driver()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.bookings
    where date = new.date
      and plate = new.plate
      and status = 'SCHEDULED'
      and driver_id <> new.driver_id
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Vehicle already has a different driver scheduled that day';
  end if;
  return new;
end;
$$;

create or replace function block_inactive_vehicle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.vehicles where plate = new.plate and status = 'Inactive') then
    raise exception 'Vehicle is inactive';
  end if;
  return new;
end;
$$;

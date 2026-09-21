-- Hardening pass on every SECURITY DEFINER function:
--   1. search_path = '' instead of 'public'. A fixed 'public' search_path
--      was already safe against the classic search-path-hijack CVE class
--      (it wasn't mutable), but '' plus fully schema-qualified references
--      is the tighter, recommended form and removes any ambiguity about
--      which objects a bare identifier could ever resolve to.
--   2. Every previously-unqualified reference to accounts/bookings/
--      booking_slots/vehicle_records/vehicles/vehicle_aliases is now
--      public.<table>. pg_catalog (generate_series, uuid/date/text/bool
--      types, etc.) resolves regardless of search_path, so only
--      application-schema references needed qualifying.
-- CREATE OR REPLACE preserves each function's existing REVOKE/GRANT state,
-- so the authenticated-only execute grants already set on create_booking/
-- update_booking/cancel_booking/rename_vehicle (and service_role's
-- schema-wide grant from 0004) are untouched by this migration.
--
-- is_admin is the one exception: it was never explicitly revoked from
-- PUBLIC, so any authenticated user could call it directly (not just via
-- RLS policies) and probe whether an arbitrary uuid belongs to an active
-- Admin. It's only ever meant to be used from inside RLS policy
-- expressions and the functions below, so its direct-call grant is
-- narrowed to authenticated (needed because policy evaluation still
-- checks the querying role's EXECUTE privilege) and revoked from PUBLIC.

create or replace function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.accounts
    where id = uid and role = 'Admin' and status = 'Active'
  );
$$;

revoke execute on function is_admin(uuid) from public;
grant execute on function is_admin(uuid) to authenticated;

create or replace function create_booking(
  p_date date,
  p_plate text,
  p_start int,
  p_end int,
  p_driver_id uuid,
  p_destination text,
  p_purpose text,
  p_notes text
) returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator public.accounts;
  v_driver public.accounts;
  v_booking public.bookings;
  v_hour int;
begin
  select * into v_creator from public.accounts where id = auth.uid();
  if v_creator is null or v_creator.status <> 'Active' or v_creator.role not in ('Booker', 'Admin') then
    raise exception 'Not authorized to create bookings' using errcode = '42501';
  end if;

  select * into v_driver from public.accounts where id = p_driver_id;
  if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' then
    raise exception 'Select an active Driver' using errcode = '22023';
  end if;

  if p_start < 0 or p_end > 24 or p_start >= p_end then
    raise exception 'Invalid time range' using errcode = '22023';
  end if;

  insert into public.bookings (
    date, plate, start_hour, end_hour, driver_id, driver_name, project,
    requested_by_account_id, requested_by_name, destination, purpose, notes,
    created_by_account_id, status
  ) values (
    p_date, p_plate, p_start, p_end, p_driver_id, v_driver.name, '',
    v_creator.id, v_creator.name, p_destination, p_purpose, coalesce(p_notes, ''),
    v_creator.id, 'SCHEDULED'
  ) returning * into v_booking;

  for v_hour in select generate_series(p_start, p_end - 1) loop
    insert into public.booking_slots (booking_id, date, plate, driver_id, hour)
    values (v_booking.id, p_date, p_plate, p_driver_id, v_hour);
  end loop;

  return v_booking;
exception
  when unique_violation then
    raise exception 'This vehicle or driver is already booked for that time' using errcode = '23505';
end;
$$;

create or replace function update_booking(
  p_booking_id uuid,
  p_date date,
  p_plate text,
  p_start int,
  p_end int,
  p_driver_id uuid,
  p_destination text,
  p_purpose text,
  p_notes text
) returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_driver public.accounts;
  v_existing public.bookings;
  v_booking public.bookings;
  v_hour int;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_existing from public.bookings where id = p_booking_id for update;
  if v_existing is null then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_existing.status <> 'SCHEDULED' then
    raise exception 'This booking is no longer active' using errcode = '22023';
  end if;
  if v_actor.role <> 'Admin' and v_existing.created_by_account_id <> v_actor.id then
    raise exception 'Not authorized to edit this booking' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.vehicle_records
    where (data ->> 'bookingId')::uuid = p_booking_id and data ->> 'submittedAt' is not null
  ) then
    raise exception 'This trip has already been submitted and is locked' using errcode = '22023';
  end if;

  select * into v_driver from public.accounts where id = p_driver_id;
  if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' then
    raise exception 'Select an active Driver' using errcode = '22023';
  end if;

  if p_start < 0 or p_end > 24 or p_start >= p_end then
    raise exception 'Invalid time range' using errcode = '22023';
  end if;

  delete from public.booking_slots where booking_id = p_booking_id;

  update public.bookings set
    date = p_date,
    plate = p_plate,
    start_hour = p_start,
    end_hour = p_end,
    driver_id = p_driver_id,
    driver_name = v_driver.name,
    destination = p_destination,
    purpose = p_purpose,
    notes = coalesce(p_notes, '')
  where id = p_booking_id
  returning * into v_booking;

  for v_hour in select generate_series(p_start, p_end - 1) loop
    insert into public.booking_slots (booking_id, date, plate, driver_id, hour)
    values (p_booking_id, p_date, p_plate, p_driver_id, v_hour);
  end loop;

  return v_booking;
exception
  when unique_violation then
    raise exception 'This vehicle or driver is already booked for that time' using errcode = '23505';
end;
$$;

create or replace function cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_existing public.bookings;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_existing from public.bookings where id = p_booking_id for update;
  if v_existing is null then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_existing.status <> 'SCHEDULED' then
    return;
  end if;
  if v_actor.role <> 'Admin' and v_existing.created_by_account_id <> v_actor.id then
    raise exception 'Not authorized to cancel this booking' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.vehicle_records
    where (data ->> 'bookingId')::uuid = p_booking_id and data ->> 'submittedAt' is not null
  ) then
    raise exception 'This trip has already been submitted and is locked' using errcode = '22023';
  end if;

  update public.bookings set status = 'CANCELLED' where id = p_booking_id;
  delete from public.booking_slots where booking_id = p_booking_id;
end;
$$;

create or replace function rename_vehicle(
  p_old_plate text,
  p_new_plate text,
  p_name text,
  p_status text
) returns public.vehicles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_vehicle public.vehicles;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_status not in ('Active', 'Inactive') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;

  if not exists (select 1 from public.vehicles where plate = p_old_plate) then
    raise exception 'Vehicle not found' using errcode = 'P0002';
  end if;

  if p_new_plate = p_old_plate then
    update public.vehicles set name = p_name, status = p_status
    where plate = p_old_plate
    returning * into v_vehicle;
    return v_vehicle;
  end if;

  if exists (select 1 from public.vehicles where plate = p_new_plate) then
    raise exception 'Plate already in use' using errcode = '23505';
  end if;

  insert into public.vehicles (plate, name, status) values (p_new_plate, p_name, p_status);

  update public.bookings set plate = p_new_plate where plate = p_old_plate;
  update public.booking_slots set plate = p_new_plate where plate = p_old_plate;
  update public.vehicle_records set plate = p_new_plate where plate = p_old_plate;

  update public.vehicle_aliases set new_plate = p_new_plate where new_plate = p_old_plate;
  insert into public.vehicle_aliases (old_plate, new_plate) values (p_old_plate, p_new_plate)
    on conflict (old_plate) do update set new_plate = excluded.new_plate;

  delete from public.vehicles where plate = p_old_plate;

  select * into v_vehicle from public.vehicles where plate = p_new_plate;
  return v_vehicle;
exception
  when unique_violation then
    raise exception 'Plate already in use' using errcode = '23505';
end;
$$;

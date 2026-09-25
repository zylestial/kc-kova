-- v2.0: retire the v1.2 booking objects.
--
-- Requests and schedules replaced bookings, booking slots and the Daily
-- Vehicle Record (Phases 4-9), and the v1 screens and API routes are gone.
-- There is no legacy data to carry over, so the tables and everything that
-- only served them are dropped:
--
--   tables      bookings, booking_slots, vehicle_records, vehicle_aliases
--   functions   create_booking, update_booking, cancel_booking,
--               approve_booking, deny_booking, and the two trigger functions
--               that only ran on bookings (enforce_same_daily_driver,
--               block_inactive_vehicle)
--
-- rename_vehicle is rewritten to stop touching them. Kept: booking_options
-- and people (requests use them) and everything under requests/schedules.
--
-- Release-time only: applying this to a project drops legacy data for good,
-- and going back to v1.2 afterwards needs a backup restore.

create or replace function rename_vehicle(
  p_old_plate text,
  p_new_plate text,
  p_name text,
  p_status text,
  p_assigned_driver_id uuid
)
returns public.vehicles
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

  -- Deliberately NOT errcode '23505' (unique_violation): this function's own
  -- "exception when unique_violation" handler below would catch a raise with
  -- that code too and rewrite it to "Plate already in use", masking this
  -- distinct error. Default (P0001) avoids that self-catch.
  if p_assigned_driver_id is not null and exists (
    select 1 from public.vehicles where assigned_driver_id = p_assigned_driver_id and plate <> p_old_plate
  ) then
    raise exception 'That Driver is already assigned to another vehicle';
  end if;

  if p_new_plate = p_old_plate then
    update public.vehicles set name = p_name, status = p_status, assigned_driver_id = p_assigned_driver_id
    where plate = p_old_plate
    returning * into v_vehicle;
    return v_vehicle;
  end if;

  if exists (select 1 from public.vehicles where plate = p_new_plate) then
    raise exception 'Plate already in use' using errcode = '23505';
  end if;

  -- assigned_driver_id is deliberately left null on this insert: the old
  -- row (below, still not yet deleted) may carry the same
  -- assigned_driver_id, and both rows existing at once would trip
  -- vehicles_assigned_driver_id_unique. Set it once the old row is gone.
  insert into public.vehicles (plate, name, status) values (p_new_plate, p_name, p_status);

  update public.schedule_revisions set plate = p_new_plate where plate = p_old_plate;
  update public.schedule_reservations set plate = p_new_plate where plate = p_old_plate;

  delete from public.vehicles where plate = p_old_plate;

  update public.vehicles set assigned_driver_id = p_assigned_driver_id
  where plate = p_new_plate
  returning * into v_vehicle;

  return v_vehicle;
exception
  when unique_violation then
    raise exception 'Plate already in use' using errcode = '23505';
end;
$$;

drop function create_booking(date, text, integer, integer, text, text, text, text, text);
drop function update_booking(uuid, date, text, integer, integer, text, text, text, text, text);
drop function cancel_booking(uuid);
drop function approve_booking(uuid);
drop function deny_booking(uuid);

-- Order matters: booking_slots has a foreign key to bookings, and the
-- vehicle_records read policy refers to bookings. Dropping a table also
-- drops its triggers, policies, indexes and grants.
drop table booking_slots;
drop table vehicle_records;
drop table bookings;
drop table vehicle_aliases;

drop function enforce_same_daily_driver();
drop function block_inactive_vehicle();

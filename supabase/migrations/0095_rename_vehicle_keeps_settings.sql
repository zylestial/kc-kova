-- Changing a vehicle's plate makes a new row and moves everything onto it
-- (0050). It used to give the new row the column defaults, so a company
-- trip vehicle with Company trips failed the trip-kind check while its
-- trips moved over, and Company requests (request_groups) still pointed at
-- the old plate. Now the new row keeps "Can be requested for company
-- trips", "Has an odometer" and, for a personal vehicle (0092), its owner;
-- and Company requests move too.

create or replace function rename_vehicle(
  p_old_plate text,
  p_new_plate text,
  p_name text,
  p_status text,
  p_assigned_driver_id uuid
) returns public.vehicles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_old public.vehicles;
  v_vehicle public.vehicles;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_status not in ('Active', 'Inactive') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;

  select * into v_old from public.vehicles where plate = p_old_plate;
  if v_old.plate is null then
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

  -- assigned_driver_id and owner_account_id are deliberately left null on
  -- this insert: the old row (below, still not yet deleted) carries them,
  -- and both rows at once would trip their unique indexes. Set them once
  -- the old row is gone.
  insert into public.vehicles (plate, name, status, company_trips, has_odometer)
  values (p_new_plate, p_name, p_status, v_old.company_trips, v_old.has_odometer);

  update public.schedule_revisions set plate = p_new_plate where plate = p_old_plate;
  update public.schedule_reservations set plate = p_new_plate where plate = p_old_plate;
  update public.requests set vehicle_plate = p_new_plate where vehicle_plate = p_old_plate;
  update public.request_groups set vehicle_plate = p_new_plate where vehicle_plate = p_old_plate;

  delete from public.vehicles where plate = p_old_plate;

  update public.vehicles set
    assigned_driver_id = case when v_old.owner_account_id is null then p_assigned_driver_id end,
    owner_account_id = v_old.owner_account_id
  where plate = p_new_plate
  returning * into v_vehicle;

  return v_vehicle;
exception
  when unique_violation then
    raise exception 'Plate already in use' using errcode = '23505';
end;
$$;

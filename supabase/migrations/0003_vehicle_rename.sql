-- Renaming a vehicle's plate must move every booking, booking_slots and
-- vehicle_records row referencing the old plate, and record the mapping in
-- vehicle_aliases, all atomically (bookings.plate has no ON UPDATE CASCADE,
-- and a plain client-side sequence of writes could partially fail). This
-- mirrors the create_booking/update_booking RPC pattern in the prior
-- migration: a single security definer function is the only write path.

create function rename_vehicle(
  p_old_plate text,
  p_new_plate text,
  p_name text,
  p_status text
) returns vehicles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor accounts;
  v_vehicle vehicles;
begin
  select * into v_actor from accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_status not in ('Active', 'Inactive') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;

  if not exists (select 1 from vehicles where plate = p_old_plate) then
    raise exception 'Vehicle not found' using errcode = 'P0002';
  end if;

  if p_new_plate = p_old_plate then
    update vehicles set name = p_name, status = p_status
    where plate = p_old_plate
    returning * into v_vehicle;
    return v_vehicle;
  end if;

  if exists (select 1 from vehicles where plate = p_new_plate) then
    raise exception 'Plate already in use' using errcode = '23505';
  end if;

  insert into vehicles (plate, name, status) values (p_new_plate, p_name, p_status);

  update bookings set plate = p_new_plate where plate = p_old_plate;
  update booking_slots set plate = p_new_plate where plate = p_old_plate;
  update vehicle_records set plate = p_new_plate where plate = p_old_plate;

  -- Repoint any earlier aliases that pointed at the old plate, so a chain
  -- of renames still resolves to the current plate.
  update vehicle_aliases set new_plate = p_new_plate where new_plate = p_old_plate;
  insert into vehicle_aliases (old_plate, new_plate) values (p_old_plate, p_new_plate)
    on conflict (old_plate) do update set new_plate = excluded.new_plate;

  delete from vehicles where plate = p_old_plate;

  select * into v_vehicle from vehicles where plate = p_new_plate;
  return v_vehicle;
exception
  when unique_violation then
    raise exception 'Plate already in use' using errcode = '23505';
end;
$$;

revoke all on function rename_vehicle(text, text, text, text) from public;
grant execute on function rename_vehicle(text, text, text, text) to authenticated;

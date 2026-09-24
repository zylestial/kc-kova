-- rename_vehicle now also moves v2 schedule revisions and reservations to
-- the new plate. Both reference vehicles(plate), so without this a rename
-- of any vehicle that has ever been scheduled would fail on the final
-- delete of the old vehicle row. Body is otherwise unchanged from
-- 0012_vehicle_driver_assignment.sql.

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

  update public.bookings set plate = p_new_plate where plate = p_old_plate;
  update public.booking_slots set plate = p_new_plate where plate = p_old_plate;
  update public.vehicle_records set plate = p_new_plate where plate = p_old_plate;
  update public.schedule_revisions set plate = p_new_plate where plate = p_old_plate;
  update public.schedule_reservations set plate = p_new_plate where plate = p_old_plate;

  update public.vehicle_aliases set new_plate = p_new_plate where new_plate = p_old_plate;
  insert into public.vehicle_aliases (old_plate, new_plate) values (p_old_plate, p_new_plate)
    on conflict (old_plate) do update set new_plate = excluded.new_plate;

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

revoke all on function rename_vehicle(text, text, text, text, uuid) from public;
revoke all on function rename_vehicle(text, text, text, text, uuid) from anon;
grant execute on function rename_vehicle(text, text, text, text, uuid) to authenticated;

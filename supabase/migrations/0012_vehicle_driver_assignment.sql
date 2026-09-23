-- Vehicle -> Driver assignment (v1.2).
--
-- Each Vehicle has at most one currently assigned active Driver. Booking
-- Step 2 no longer lets the client pick a Driver directly: create_booking/
-- update_booking now derive the Driver from the chosen Vehicle's assignment
-- server-side, so a modified client request can't pick an arbitrary Driver
-- (hide-the-button is not security). Already-confirmed bookings keep their
-- own snapshotted driver_id/driver_name untouched by a later reassignment,
-- since those columns are only written at create/update time, not read live
-- off vehicles.assigned_driver_id.

alter table vehicles
  add column assigned_driver_id uuid references accounts (id);

-- One Driver can be assigned to at most one Vehicle at a time.
create unique index vehicles_assigned_driver_id_unique
  on vehicles (assigned_driver_id)
  where assigned_driver_id is not null;

create function enforce_active_driver_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_driver_id is not null and not exists (
    select 1 from public.accounts
    where id = new.assigned_driver_id and role = 'Driver' and status = 'Active'
  ) then
    raise exception 'Assigned Driver must be an active Driver' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger vehicles_enforce_active_driver_assignment
  before insert or update on vehicles
  for each row
  execute function enforce_active_driver_assignment();

-- If a Driver is deactivated or their role changes away from Driver, any
-- Vehicle still pointing at them as their assigned Driver is auto-unassigned
-- rather than silently left referencing an ineligible account.
create function unassign_inactive_driver()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.role <> 'Driver' or new.status <> 'Active') then
    update public.vehicles set assigned_driver_id = null where assigned_driver_id = new.id;
  end if;
  return new;
end;
$$;

create trigger accounts_unassign_inactive_driver
  after update on accounts
  for each row
  when (old.role is distinct from new.role or old.status is distinct from new.status)
  execute function unassign_inactive_driver();

-- rename_vehicle gains p_assigned_driver_id, threaded through both the
-- same-plate update and the rename (delete+reinsert) path so it isn't lost
-- on a plate change the way it would be if left off the explicit column list.
drop function if exists rename_vehicle(text, text, text, text);

create function rename_vehicle(
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

-- create_booking/update_booking: drop p_driver_id, derive the Driver from
-- the chosen Vehicle's current assignment instead of trusting the client.
drop function if exists create_booking(date, text, int, int, uuid, text, text, text, text, text);

create function create_booking(
  p_date date,
  p_plate text,
  p_start int,
  p_end int,
  p_destination text,
  p_purpose text,
  p_notes text,
  p_booking_type text,
  p_urgent_reason text
) returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator public.accounts;
  v_vehicle public.vehicles;
  v_driver public.accounts;
  v_booking public.bookings;
  v_today_manila date;
begin
  select * into v_creator from public.accounts where id = auth.uid();
  if v_creator is null or v_creator.status <> 'Active' or v_creator.role not in ('Booker', 'Admin') then
    raise exception 'Not authorized to create bookings' using errcode = '42501';
  end if;

  select * into v_vehicle from public.vehicles where plate = p_plate;
  if v_vehicle is null or v_vehicle.status <> 'Active' then
    raise exception 'Select an active Vehicle' using errcode = '22023';
  end if;
  if v_vehicle.assigned_driver_id is null then
    raise exception 'This vehicle has no Driver assigned' using errcode = '22023';
  end if;

  select * into v_driver from public.accounts where id = v_vehicle.assigned_driver_id;
  if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' then
    raise exception 'This vehicle has no Driver assigned' using errcode = '22023';
  end if;

  if p_start < 0 or p_end > 24 or p_start >= p_end then
    raise exception 'Invalid time range' using errcode = '22023';
  end if;

  if v_creator.role <> 'Admin'
     and (p_date < current_date or (p_date = current_date and p_start < extract(hour from now())))
  then
    raise exception 'Cannot book a time slot that has already passed' using errcode = '22023';
  end if;

  if p_booking_type not in ('REGULAR', 'URGENT') then
    raise exception 'Invalid booking type' using errcode = '22023';
  end if;

  v_today_manila := (now() at time zone 'Asia/Manila')::date;

  if not (v_creator.role = 'Admin' and p_date < v_today_manila) then
    if p_booking_type = 'REGULAR' then
      if p_date < v_today_manila + 7 then
        raise exception 'Regular bookings require at least 7 days'' notice' using errcode = '22023';
      end if;
    elsif coalesce(trim(p_urgent_reason), '') = '' then
      raise exception 'Urgent bookings require a stated reason' using errcode = '22023';
    end if;
  end if;

  insert into public.bookings (
    date, plate, start_hour, end_hour, driver_id, driver_name, project,
    requested_by_account_id, requested_by_name, destination, purpose, notes,
    created_by_account_id, status, booking_type, urgent_reason
  ) values (
    p_date, p_plate, p_start, p_end, v_driver.id, v_driver.name, '',
    v_creator.id, v_creator.name, p_destination, p_purpose, coalesce(p_notes, ''),
    v_creator.id, 'PENDING', p_booking_type,
    case when p_booking_type = 'URGENT' then trim(p_urgent_reason) else '' end
  ) returning * into v_booking;

  return v_booking;
end;
$$;

revoke execute on function create_booking(date, text, int, int, text, text, text, text, text) from public;
revoke execute on function create_booking(date, text, int, int, text, text, text, text, text) from anon;
grant execute on function create_booking(date, text, int, int, text, text, text, text, text) to authenticated;

drop function if exists update_booking(uuid, date, text, int, int, uuid, text, text, text, text, text);

create function update_booking(
  p_booking_id uuid,
  p_date date,
  p_plate text,
  p_start int,
  p_end int,
  p_destination text,
  p_purpose text,
  p_notes text,
  p_booking_type text,
  p_urgent_reason text
) returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_vehicle public.vehicles;
  v_driver public.accounts;
  v_existing public.bookings;
  v_booking public.bookings;
  v_hour int;
  v_today_manila date;
  v_schedule_changed boolean;
  v_type_changed boolean;
  v_new_status text;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_existing from public.bookings where id = p_booking_id for update;
  if v_existing is null then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_existing.status not in ('PENDING', 'SCHEDULED') then
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

  select * into v_vehicle from public.vehicles where plate = p_plate;
  if v_vehicle is null or v_vehicle.status <> 'Active' then
    raise exception 'Select an active Vehicle' using errcode = '22023';
  end if;
  if v_vehicle.assigned_driver_id is null then
    raise exception 'This vehicle has no Driver assigned' using errcode = '22023';
  end if;

  select * into v_driver from public.accounts where id = v_vehicle.assigned_driver_id;
  if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' then
    raise exception 'This vehicle has no Driver assigned' using errcode = '22023';
  end if;

  if p_start < 0 or p_end > 24 or p_start >= p_end then
    raise exception 'Invalid time range' using errcode = '22023';
  end if;

  v_schedule_changed :=
    v_existing.date is distinct from p_date
    or v_existing.plate is distinct from p_plate
    or v_existing.start_hour is distinct from p_start
    or v_existing.end_hour is distinct from p_end
    or v_existing.driver_id is distinct from v_driver.id;
  v_type_changed :=
    v_existing.booking_type is distinct from p_booking_type
    or v_existing.urgent_reason is distinct from coalesce(trim(p_urgent_reason), '');

  if v_actor.role <> 'Admin'
     and (p_date < current_date or (p_date = current_date and p_start < extract(hour from now())))
  then
    raise exception 'Cannot move a booking to a time slot that has already passed' using errcode = '22023';
  end if;

  if p_booking_type not in ('REGULAR', 'URGENT') then
    raise exception 'Invalid booking type' using errcode = '22023';
  end if;

  if v_schedule_changed or v_type_changed then
    v_today_manila := (now() at time zone 'Asia/Manila')::date;
    if not (v_actor.role = 'Admin' and p_date < v_today_manila) then
      if p_booking_type = 'REGULAR' then
        if p_date < v_today_manila + 7 then
          raise exception 'Regular bookings require at least 7 days'' notice' using errcode = '22023';
        end if;
      elsif coalesce(trim(p_urgent_reason), '') = '' then
        raise exception 'Urgent bookings require a stated reason' using errcode = '22023';
      end if;
    end if;
  end if;

  v_new_status := case
    when v_existing.status = 'SCHEDULED' and (v_schedule_changed or v_type_changed) then 'PENDING'
    else v_existing.status
  end;

  delete from public.booking_slots where booking_id = p_booking_id;

  update public.bookings set
    date = p_date,
    plate = p_plate,
    start_hour = p_start,
    end_hour = p_end,
    driver_id = v_driver.id,
    driver_name = v_driver.name,
    destination = p_destination,
    purpose = p_purpose,
    notes = coalesce(p_notes, ''),
    booking_type = p_booking_type,
    urgent_reason = case when p_booking_type = 'URGENT' then trim(p_urgent_reason) else '' end,
    status = v_new_status
  where id = p_booking_id
  returning * into v_booking;

  if v_new_status = 'SCHEDULED' then
    for v_hour in select generate_series(p_start, p_end - 1) loop
      insert into public.booking_slots (booking_id, date, plate, driver_id, hour)
      values (p_booking_id, p_date, p_plate, v_driver.id, v_hour);
    end loop;
  end if;

  return v_booking;
exception
  when unique_violation then
    raise exception 'This vehicle or driver is already booked for that time' using errcode = '23505';
end;
$$;

revoke execute on function update_booking(uuid, date, text, int, int, text, text, text, text, text) from public;
revoke execute on function update_booking(uuid, date, text, int, int, text, text, text, text, text) from anon;
grant execute on function update_booking(uuid, date, text, int, int, text, text, text, text, text) to authenticated;

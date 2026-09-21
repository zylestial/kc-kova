-- Booking writes go through these functions instead of direct table access.
-- supabase-js has no multi-statement transaction API, but a single function
-- call is one transaction, so this is what makes the vehicle/driver conflict
-- check in booking_slots' unique indexes atomic under concurrent requests.
-- security definer lets the function bypass bookings/booking_slots RLS (which
-- grants no direct write policies to anyone); each function re-checks role,
-- ownership and lock rules itself using auth.uid().

create function create_booking(
  p_date date,
  p_plate text,
  p_start int,
  p_end int,
  p_driver_id uuid,
  p_destination text,
  p_purpose text,
  p_notes text
) returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator accounts;
  v_driver accounts;
  v_booking bookings;
  v_hour int;
begin
  select * into v_creator from accounts where id = auth.uid();
  if v_creator is null or v_creator.status <> 'Active' or v_creator.role not in ('Booker', 'Admin') then
    raise exception 'Not authorized to create bookings' using errcode = '42501';
  end if;

  select * into v_driver from accounts where id = p_driver_id;
  if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' then
    raise exception 'Select an active Driver' using errcode = '22023';
  end if;

  if p_start < 0 or p_end > 24 or p_start >= p_end then
    raise exception 'Invalid time range' using errcode = '22023';
  end if;

  insert into bookings (
    date, plate, start_hour, end_hour, driver_id, driver_name, project,
    requested_by_account_id, requested_by_name, destination, purpose, notes,
    created_by_account_id, status
  ) values (
    p_date, p_plate, p_start, p_end, p_driver_id, v_driver.name, '',
    v_creator.id, v_creator.name, p_destination, p_purpose, coalesce(p_notes, ''),
    v_creator.id, 'SCHEDULED'
  ) returning * into v_booking;

  for v_hour in select generate_series(p_start, p_end - 1) loop
    insert into booking_slots (booking_id, date, plate, driver_id, hour)
    values (v_booking.id, p_date, p_plate, p_driver_id, v_hour);
  end loop;

  return v_booking;
exception
  when unique_violation then
    raise exception 'This vehicle or driver is already booked for that time' using errcode = '23505';
end;
$$;

create function update_booking(
  p_booking_id uuid,
  p_date date,
  p_plate text,
  p_start int,
  p_end int,
  p_driver_id uuid,
  p_destination text,
  p_purpose text,
  p_notes text
) returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor accounts;
  v_driver accounts;
  v_existing bookings;
  v_booking bookings;
  v_hour int;
begin
  select * into v_actor from accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_existing from bookings where id = p_booking_id for update;
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
    select 1 from vehicle_records
    where (data ->> 'bookingId')::uuid = p_booking_id and data ->> 'submittedAt' is not null
  ) then
    raise exception 'This trip has already been submitted and is locked' using errcode = '22023';
  end if;

  select * into v_driver from accounts where id = p_driver_id;
  if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' then
    raise exception 'Select an active Driver' using errcode = '22023';
  end if;

  if p_start < 0 or p_end > 24 or p_start >= p_end then
    raise exception 'Invalid time range' using errcode = '22023';
  end if;

  delete from booking_slots where booking_id = p_booking_id;

  update bookings set
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
    insert into booking_slots (booking_id, date, plate, driver_id, hour)
    values (p_booking_id, p_date, p_plate, p_driver_id, v_hour);
  end loop;

  return v_booking;
exception
  when unique_violation then
    raise exception 'This vehicle or driver is already booked for that time' using errcode = '23505';
end;
$$;

create function cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor accounts;
  v_existing bookings;
begin
  select * into v_actor from accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_existing from bookings where id = p_booking_id for update;
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
    select 1 from vehicle_records
    where (data ->> 'bookingId')::uuid = p_booking_id and data ->> 'submittedAt' is not null
  ) then
    raise exception 'This trip has already been submitted and is locked' using errcode = '22023';
  end if;

  update bookings set status = 'CANCELLED' where id = p_booking_id;
  delete from booking_slots where booking_id = p_booking_id;
end;
$$;

revoke all on function create_booking(date, text, int, int, uuid, text, text, text) from public;
revoke all on function update_booking(uuid, date, text, int, int, uuid, text, text, text) from public;
revoke all on function cancel_booking(uuid) from public;

grant execute on function create_booking(date, text, int, int, uuid, text, text, text) to authenticated;
grant execute on function update_booking(uuid, date, text, int, int, uuid, text, text, text) to authenticated;
grant execute on function cancel_booking(uuid) to authenticated;

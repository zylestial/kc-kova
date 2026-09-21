-- Bookers could previously create/move a booking into a time slot that has
-- already passed, since create_booking/update_booking only validated
-- p_start < p_end, not that the slot was in the future. Admins still need
-- this (e.g. logging a trip that already happened), so the new check is
-- role-gated rather than a blanket rule.
--
-- now()/current_date run in the database session's timezone, which Supabase
-- sets to UTC. The client's "today"/"past" comparisons are computed in the
-- browser's local timezone, so a slot right at a day boundary can be judged
-- differently by each layer; this is a known limitation of not persisting
-- accounts' timezone.

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

  if v_creator.role <> 'Admin'
     and (p_date < current_date or (p_date = current_date and p_start < extract(hour from now())))
  then
    raise exception 'Cannot book a time slot that has already passed' using errcode = '22023';
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

  if v_actor.role <> 'Admin'
     and (p_date < current_date or (p_date = current_date and p_start < extract(hour from now())))
  then
    raise exception 'Cannot move a booking to a time slot that has already passed' using errcode = '22023';
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

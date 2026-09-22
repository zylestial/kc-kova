-- Booking Type (Regular/Urgent) + universal Admin approval.
--
-- Every new/rescheduled booking is now created PENDING and holds no
-- booking_slots rows, so it never blocks a slot for anyone, including
-- itself. An Admin reviews it and either approves it (cancelling any
-- SCHEDULED booking(s) it conflicts with, then reserving its slots and
-- promoting it to SCHEDULED) or denies it (REJECTED, nothing else
-- touched). Editing an already-SCHEDULED booking's date/time/vehicle/
-- driver or Booking Type/Urgent Reason drops it back to PENDING for
-- re-approval; editing only destination/purpose/notes does not.
--
-- Booking Type carries its own deadline rule: Regular needs 7 Asia/Manila
-- calendar days' notice; Urgent is same/next-day only (Manila) and
-- requires a stated reason. Applies to everyone, Admin included, with one
-- exception: the existing "Admin can log an already-elapsed slot" rule
-- (0010_prevent_past_bookings.sql) is preserved by also bypassing the new
-- deadline checks whenever an Admin is logging a date before today.

alter table bookings
  add column booking_type text not null default 'REGULAR'
    check (booking_type in ('REGULAR', 'URGENT')),
  add column urgent_reason text not null default '';

alter table bookings drop constraint bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('PENDING', 'SCHEDULED', 'REJECTED', 'CANCELLED'));

-- Arity changed (8 args -> 10), so the old overload needs dropping
-- explicitly or it would linger, reachable, with its own separate grants.
drop function if exists create_booking(date, text, int, int, uuid, text, text, text);

create or replace function create_booking(
  p_date date,
  p_plate text,
  p_start int,
  p_end int,
  p_driver_id uuid,
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
  v_driver public.accounts;
  v_booking public.bookings;
  v_today_manila date;
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

  if p_booking_type not in ('REGULAR', 'URGENT') then
    raise exception 'Invalid booking type' using errcode = '22023';
  end if;

  v_today_manila := (now() at time zone 'Asia/Manila')::date;

  -- Admin logging a genuinely past date: preserve the existing
  -- "log an already-elapsed slot" exemption by skipping the deadline
  -- rules entirely for that case.
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
    p_date, p_plate, p_start, p_end, p_driver_id, v_driver.name, '',
    v_creator.id, v_creator.name, p_destination, p_purpose, coalesce(p_notes, ''),
    v_creator.id, 'PENDING', p_booking_type,
    case when p_booking_type = 'URGENT' then trim(p_urgent_reason) else '' end
  ) returning * into v_booking;

  return v_booking;
end;
$$;

revoke execute on function create_booking(date, text, int, int, uuid, text, text, text, text, text) from public;
revoke execute on function create_booking(date, text, int, int, uuid, text, text, text, text, text) from anon;
grant execute on function create_booking(date, text, int, int, uuid, text, text, text, text, text) to authenticated;

drop function if exists update_booking(uuid, date, text, int, int, uuid, text, text, text);

create or replace function update_booking(
  p_booking_id uuid,
  p_date date,
  p_plate text,
  p_start int,
  p_end int,
  p_driver_id uuid,
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

  select * into v_driver from public.accounts where id = p_driver_id;
  if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' then
    raise exception 'Select an active Driver' using errcode = '22023';
  end if;

  if p_start < 0 or p_end > 24 or p_start >= p_end then
    raise exception 'Invalid time range' using errcode = '22023';
  end if;

  v_schedule_changed :=
    v_existing.date is distinct from p_date
    or v_existing.plate is distinct from p_plate
    or v_existing.start_hour is distinct from p_start
    or v_existing.end_hour is distinct from p_end
    or v_existing.driver_id is distinct from p_driver_id;
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
    driver_id = p_driver_id,
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
      values (p_booking_id, p_date, p_plate, p_driver_id, v_hour);
    end loop;
  end if;

  return v_booking;
exception
  when unique_violation then
    raise exception 'This vehicle or driver is already booked for that time' using errcode = '23505';
end;
$$;

revoke execute on function update_booking(uuid, date, text, int, int, uuid, text, text, text, text, text) from public;
revoke execute on function update_booking(uuid, date, text, int, int, uuid, text, text, text, text, text) from anon;
grant execute on function update_booking(uuid, date, text, int, int, uuid, text, text, text, text, text) to authenticated;

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
  if v_existing.status not in ('PENDING', 'SCHEDULED') then
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

revoke execute on function cancel_booking(uuid) from public;
revoke execute on function cancel_booking(uuid) from anon;
grant execute on function cancel_booking(uuid) to authenticated;

create or replace function approve_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_existing public.bookings;
  v_booking public.bookings;
  v_vehicle public.vehicles;
  v_driver public.accounts;
  v_hour int;
  v_conflict record;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select * into v_existing from public.bookings where id = p_booking_id for update;
  if v_existing is null then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_existing.status <> 'PENDING' then
    raise exception 'Only pending bookings can be approved' using errcode = '22023';
  end if;

  select * into v_vehicle from public.vehicles where plate = v_existing.plate;
  if v_vehicle is null or v_vehicle.status <> 'Active' then
    raise exception 'Vehicle is no longer active' using errcode = '22023';
  end if;

  select * into v_driver from public.accounts where id = v_existing.driver_id;
  if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' then
    raise exception 'Driver is no longer active' using errcode = '22023';
  end if;

  -- Cancel every currently-SCHEDULED booking whose booking_slots overlap
  -- this one's date/hours on the same vehicle or driver. booking_slots is
  -- the authoritative conflict surface (it's exactly what the unique
  -- constraints protect).
  for v_conflict in
    select b.id
    from public.bookings b
    where b.status = 'SCHEDULED'
      and exists (
        select 1 from public.booking_slots s
        where s.booking_id = b.id
          and s.date = v_existing.date
          and s.hour >= v_existing.start_hour and s.hour < v_existing.end_hour
          and (s.plate = v_existing.plate or s.driver_id = v_existing.driver_id)
      )
    for update of b
  loop
    update public.bookings set status = 'CANCELLED' where id = v_conflict.id;
    delete from public.booking_slots where booking_id = v_conflict.id;
  end loop;

  update public.bookings set status = 'SCHEDULED' where id = p_booking_id
  returning * into v_booking;

  for v_hour in select generate_series(v_existing.start_hour, v_existing.end_hour - 1) loop
    insert into public.booking_slots (booking_id, date, plate, driver_id, hour)
    values (p_booking_id, v_existing.date, v_existing.plate, v_existing.driver_id, v_hour);
  end loop;

  return v_booking;
end;
$$;

revoke execute on function approve_booking(uuid) from public;
revoke execute on function approve_booking(uuid) from anon;
grant execute on function approve_booking(uuid) to authenticated;

create or replace function deny_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_existing public.bookings;
  v_booking public.bookings;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select * into v_existing from public.bookings where id = p_booking_id for update;
  if v_existing is null then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_existing.status <> 'PENDING' then
    raise exception 'Only pending bookings can be denied' using errcode = '22023';
  end if;

  update public.bookings set status = 'REJECTED' where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke execute on function deny_booking(uuid) from public;
revoke execute on function deny_booking(uuid) from anon;
grant execute on function deny_booking(uuid) to authenticated;

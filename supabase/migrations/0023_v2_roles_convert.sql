-- v2.0 roles, step 2 of 2 (migrate + contract): Booker becomes Requester.
--
-- RELEASE-TIME MIGRATION. Apply only together with the v2 application at
-- cutover (docs/v2/phase-3-schema.md, "Release order"). v1.2 code only
-- knows Booker, so once this runs, v1.2 can no longer serve former Booker
-- accounts -- an old-code rollback after this point needs the reversal in
-- that document, not just a Vercel redeploy.
--
-- Account ids, names, auth identities and every ownership link are
-- untouched; only the role value changes. KOVA reads the role from
-- accounts on every request (lib/supabase/session.ts) and never stores it
-- in the auth token, so there are no stale role claims to invalidate and
-- nobody has to sign in again.
--
-- Historical audit_events keep actor_role = 'Booker' where that was true
-- at the time; they are evidence and are not rewritten.

update accounts set role = 'Requester' where role = 'Booker';

alter table accounts drop constraint accounts_role_check;
alter table accounts add constraint accounts_role_check
  check (role in ('Requester', 'Scheduler', 'Driver', 'Admin'));

-- Legacy v1.2 read policy on bookings: Booker -> Requester.
drop policy bookings_select on bookings;
create policy bookings_select on bookings for select
  using (
    driver_id = (select auth.uid())
    or requested_by_account_id = (select auth.uid())
    or created_by_account_id = (select auth.uid())
    or exists (
      select 1 from accounts
      where id = (select auth.uid()) and role in ('Requester', 'Admin') and status = 'Active'
    )
  );

-- Legacy v1.2 create_booking: Booker -> Requester. Body otherwise
-- unchanged from 0012_vehicle_driver_assignment.sql. Kept callable until
-- the v2 request screens replace the old booking flow (Phase 4/5), then
-- retired in that phase's cleanup.
create or replace function create_booking(
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
  if v_creator is null or v_creator.status <> 'Active' or v_creator.role not in ('Requester', 'Admin') then
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

-- One trip per vehicle per day (owner's call, 2026-10-09): once a vehicle is
-- on a schedule for a day, no other schedule may use it that day, even at
-- other times. Before this only overlapping times were refused
-- (schedule_reservations_vehicle_overlap). A schedule counts while it's
-- ACTIVE and has a live version (draft, submitted, returned or approved);
-- cancelling or discarding it frees the vehicle again. A schedule's own
-- revisions may keep its vehicle. A schedule's date never changes once
-- created (save_schedule_draft refuses it), so checking versions is enough.

create function enforce_one_trip_per_vehicle_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_other uuid;
begin
  if new.status not in ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') then
    return new;
  end if;
  select schedule_date into v_date from public.schedules where id = new.schedule_id;
  -- Two Schedulers saving the same vehicle and day at once queue here.
  perform pg_advisory_xact_lock(hashtext('vehicle-day:' || new.plate || ':' || v_date::text));

  select s.id into v_other
  from public.schedules s
  join public.schedule_revisions r on r.schedule_id = s.id
  where s.id <> new.schedule_id
    and s.status = 'ACTIVE'
    and s.schedule_date = v_date
    and r.plate = new.plate
    and r.status in ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')
  limit 1;
  if v_other is not null then
    raise exception '% already has a trip on this day. Choose another vehicle.', new.plate using errcode = '23P01';
  end if;
  return new;
end;
$$;

revoke execute on function enforce_one_trip_per_vehicle_day() from public, anon, authenticated;

create trigger schedule_revisions_one_trip_per_vehicle_day
  before insert or update of plate, status on schedule_revisions
  for each row execute function enforce_one_trip_per_vehicle_day();

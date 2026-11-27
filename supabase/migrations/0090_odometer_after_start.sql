-- The starting odometer is entered after Start trip (owner, 2026-11-16).
-- Start trip is a tap like any other and never waits for a reading; the
-- Driver then types the reading, and the screen asks for it before Arrived.
--
-- Daily trip: trip_attendance keeps the reading (new start_odometer), and
-- Complete trip shows it filled in, still editable; the completion's own
-- start_odometer stays the trip's record. Company trip: Start trip may now
-- leave company_trip_runs.start_odometer empty on a vehicle with an
-- odometer, and set_start_odometer fills it. End trip is unchanged (0078):
-- readings at the end only when the start has one, so a vehicle whose
-- switch was turned on mid-trip still ends; the screen makes the Driver
-- enter the reading before Arrived. A vehicle without an odometer takes no
-- reading at all. start_company_trip is as in 0078 apart from that.

alter table trip_attendance
  add column start_odometer integer check (start_odometer >= 0);
comment on column trip_attendance.start_odometer is
  'The starting reading the Driver entered after Start trip (0090); Complete trip shows it.';

create or replace function start_company_trip(
  p_schedule_id uuid,
  p_odometer integer,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_address text default null
)
returns public.company_trip_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_revision public.schedule_revisions;
  v_run public.company_trip_runs;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  v_revision := public.company_trip_for_recording(p_schedule_id, v_actor);
  select * into v_run from public.company_trip_runs where schedule_id = p_schedule_id;
  if found then
    return v_run;
  end if;
  if (select schedule_date from public.schedules where id = p_schedule_id) > (now() at time zone 'Asia/Manila')::date then
    raise exception 'This trip can''t be started before its date' using errcode = '22023';
  end if;
  -- The reading may come now or after Start trip (set_start_odometer).
  if not public.vehicle_has_odometer(v_revision.plate) then
    p_odometer := null;
  elsif p_odometer < 0 then
    raise exception 'Enter the starting odometer reading, in whole kilometres' using errcode = '22023';
  end if;
  perform public.check_tap_location(p_lat, p_lng, p_accuracy_m);

  perform set_config('kova.audit_action', 'company_trip.start', true);
  insert into public.company_trip_runs (
    schedule_id, revision_id, start_odometer, start_lat, start_lng, start_accuracy_m, start_address, started_by_account_id
  ) values (
    p_schedule_id, v_revision.id, p_odometer, p_lat, p_lng, p_accuracy_m,
    case when p_lat is null then null else nullif(left(trim(p_address), 300), '') end, v_actor.id
  ) returning * into v_run;
  return v_run;
end;
$$;

-- The starting reading, entered (or corrected) after Start trip: on a Daily
-- trip until it's completed, on a Company trip until End trip. The trip's
-- Driver, or an Admin; whoever may record a Company trip (0079).
create function set_start_odometer(p_schedule_id uuid, p_odometer integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_attendance public.trip_attendance;
  v_run public.company_trip_runs;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor.id is null or v_actor.status <> 'Active' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_odometer is null or p_odometer < 0 then
    raise exception 'Enter the starting odometer reading, in whole kilometres' using errcode = '22023';
  end if;
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if v_schedule.id is null then
    raise exception 'Trip not found' using errcode = 'P0002';
  end if;

  if v_schedule.kind = 'COMPANY' then
    v_revision := public.company_trip_for_recording(p_schedule_id, v_actor);
    select * into v_run from public.company_trip_runs where schedule_id = p_schedule_id for update;
    if v_run.id is null then
      raise exception 'Tap Start trip first' using errcode = '22023';
    end if;
    if v_run.end_at is not null then
      raise exception 'This trip has ended; its readings can''t change here' using errcode = '22023';
    end if;
  else
    select * into v_attendance from public.trip_attendance where schedule_id = p_schedule_id for update;
    if v_attendance.id is null or (v_actor.role <> 'Admin' and v_attendance.driver_id <> v_actor.id) then
      raise exception 'Tap Start trip first' using errcode = '22023';
    end if;
    if v_schedule.status <> 'ACTIVE' then
      raise exception 'This trip is no longer active' using errcode = '22023';
    end if;
    if exists (select 1 from public.trip_completions where schedule_id = p_schedule_id) then
      raise exception 'This trip is completed; its readings can''t change here' using errcode = '22023';
    end if;
    select * into v_revision from public.schedule_revisions where id = v_attendance.revision_id;
  end if;
  if not public.vehicle_has_odometer(v_revision.plate) then
    raise exception 'This vehicle has no odometer' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'trip.start_odometer', true);
  if v_schedule.kind = 'COMPANY' then
    update public.company_trip_runs set start_odometer = p_odometer where id = v_run.id;
  else
    update public.trip_attendance set start_odometer = p_odometer where id = v_attendance.id;
  end if;
  return p_odometer;
end;
$$;

revoke execute on function set_start_odometer(uuid, integer) from public, anon;
grant execute on function set_start_odometer(uuid, integer) to authenticated;

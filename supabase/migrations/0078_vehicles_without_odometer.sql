-- Vehicles without an odometer (owner's request, 2026-10-21). Some
-- vehicles have none, so a reading can't be asked for. Each vehicle gets
-- "Has an odometer" (on unless an Admin turns it off); a trip on one
-- without skips the readings: the Driver's Complete trip and a Company
-- trip's Start and End trip save no odometer. A vehicle with one still
-- needs both readings, as before.
--
-- Whether a trip needs readings is decided from its vehicle when it's
-- completed (Daily) or started (Company); a Company trip's End trip
-- follows its Start, so turning the switch mid-trip can't strand it.
-- Each function below is as before apart from the odometer check.

alter table vehicles add column has_odometer boolean not null default true;
comment on column vehicles.has_odometer is 'Off for a vehicle with no odometer: its trips record no readings (0078).';

-- Readings are now optional, but a trip has both or neither.
alter table trip_completions
  alter column start_odometer drop not null,
  alter column end_odometer drop not null,
  add constraint trip_completions_odometers_together check ((start_odometer is null) = (end_odometer is null));

alter table company_trip_runs alter column start_odometer drop not null;

-- 0055's "ended means an end reading" check, found by what it says since
-- its name was generated.
do $$
declare
  v_name text;
begin
  select conname into strict v_name from pg_constraint
  where conrelid = 'public.company_trip_runs'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%(end_at IS NULL) = (end_odometer IS NULL)%';
  execute format('alter table public.company_trip_runs drop constraint %I', v_name);
end;
$$;
alter table company_trip_runs
  add constraint company_trip_runs_ended_by check ((end_at is null) = (ended_by_account_id is null)),
  add constraint company_trip_runs_end_odometer check (end_at is not null or end_odometer is null),
  add constraint company_trip_runs_odometers_together check (end_at is null or (start_odometer is null) = (end_odometer is null));

-- Whether a vehicle has an odometer; a plate not found counts as having one.
create function vehicle_has_odometer(p_plate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select has_odometer from public.vehicles where plate = p_plate), true);
$$;

revoke execute on function vehicle_has_odometer(text) from public, anon, authenticated;

create or replace function submit_completion(
  p_schedule_id uuid,
  p_start_odometer integer,
  p_end_odometer integer,
  p_full_tank boolean default null,
  p_fleet_card_used boolean default null,
  p_gas_receipt_attached boolean default null
)
returns public.trip_completions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_existing public.trip_completions;
  v_completion public.trip_completions;
  v_is_override boolean := false;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Driver', 'Admin') then
    raise exception 'Driver access required' using errcode = '42501';
  end if;
  if v_actor.role = 'Admin' then
    v_is_override := true;
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_revision from public.schedule_revisions
  where id = v_schedule.published_revision_id and status = 'APPROVED';
  if v_revision is null or (v_revision.driver_id <> v_actor.id and not v_is_override) then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.trip_completions where schedule_id = p_schedule_id;
  if found then
    return v_existing;
  end if;

  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;

  if not public.vehicle_has_odometer(v_revision.plate) then
    p_start_odometer := null;
    p_end_odometer := null;
  elsif p_start_odometer is null or p_end_odometer is null
     or p_start_odometer < 0 or p_end_odometer < p_start_odometer then
    raise exception 'Enter whole-number odometer readings, with the end no lower than the start'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.trip_attendance where schedule_id = p_schedule_id and end_at is not null
  ) then
    raise exception 'Tap Start trip and End trip before submitting' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'completion.submit', true);
  if v_is_override then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;
  insert into public.trip_completions (
    schedule_id, revision_id, driver_id, start_odometer, end_odometer,
    full_tank, fleet_card_used, gas_receipt_attached
  )
  values (
    p_schedule_id, v_revision.id, v_actor.id, p_start_odometer, p_end_odometer,
    p_full_tank, p_fleet_card_used, p_gas_receipt_attached
  )
  returning * into v_completion;

  return v_completion;
end;
$$;

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
  if not public.vehicle_has_odometer(v_revision.plate) then
    p_odometer := null;
  elsif p_odometer is null or p_odometer < 0 then
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

create or replace function end_company_trip(
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
  v_last integer;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  v_revision := public.company_trip_for_recording(p_schedule_id, v_actor);
  select * into v_run from public.company_trip_runs where schedule_id = p_schedule_id for update;
  if v_run.id is null then
    raise exception 'Tap Start trip first' using errcode = '22023';
  end if;
  if v_run.end_at is not null then
    return v_run;
  end if;
  select max(leg_no) into v_last from public.schedule_legs where revision_id = v_revision.id;
  if v_last > 1 and not exists (
    select 1 from public.stop_taps t join public.schedule_legs l on l.id = t.leg_id
    where l.revision_id = v_revision.id and l.leg_no = v_last - 1 and t.kind = 'LEAVE'
  ) and not exists (
    select 1 from public.schedule_legs l
    where l.revision_id = v_revision.id and l.leg_no = v_last - 1 and public.leg_missed(l.id)
  ) then
    raise exception 'Tap Leaving the stop before the last one first' using errcode = '22023';
  end if;
  -- Readings at the end only when the trip started with one.
  if v_run.start_odometer is null then
    p_odometer := null;
  elsif p_odometer is null or p_odometer < v_run.start_odometer then
    raise exception 'Enter the ending odometer reading; it can''t be lower than the start (% km)', v_run.start_odometer
      using errcode = '22023';
  end if;
  perform public.check_tap_location(p_lat, p_lng, p_accuracy_m);

  perform set_config('kova.audit_action', 'company_trip.end', true);
  update public.company_trip_runs set
    end_at = now(),
    end_odometer = p_odometer,
    end_lat = p_lat,
    end_lng = p_lng,
    end_accuracy_m = p_accuracy_m,
    end_address = case when p_lat is null then null else nullif(left(trim(p_address), 300), '') end,
    ended_by_account_id = v_actor.id
  where id = v_run.id
  returning * into v_run;

  insert into public.trip_completions (schedule_id, revision_id, driver_id, start_odometer, end_odometer)
  values (p_schedule_id, v_revision.id, v_revision.driver_id, v_run.start_odometer, v_run.end_odometer);
  return v_run;
end;
$$;

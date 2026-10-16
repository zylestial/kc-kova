-- The requester records their own Company trip (Company Trip Flow
-- prototype, step "Drive"): the Driver drives, the requester taps.
--
--   Start trip   at the starting point, with the starting odometer
--   Arrived / Leaving at each stop but the last
--   End trip     on arriving at the last stop, with the ending odometer
--
-- The times fill the Company Trip Form the same way a Daily trip's fill
-- its form (0045): leg 1 TIME OUT is Start trip, leg N TIME IN is Arrived
-- at it (End trip for the last), leg N+1 TIME OUT is Leaving leg N. End
-- trip submits the trip (a trip_completions row with both odometers), so
-- it reaches Finished Trips. Company trips are not recorded in
-- Attendance: the Driver's Start/End trip (0042) refuses them.
--
-- Anyone with a stop on the trip may record it (normally one requester);
-- an Admin may record for them, flagged as an override. Server time, the
-- phone's position when shared, flag-never-block, as for Drivers. A repeat
-- tap returns the first.

create table company_trip_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null unique references schedules (id),
  revision_id uuid not null references schedule_revisions (id),
  start_at timestamptz not null default now(),
  start_odometer integer not null check (start_odometer >= 0),
  start_lat double precision check (start_lat between -90 and 90),
  start_lng double precision check (start_lng between -180 and 180),
  start_accuracy_m double precision check (start_accuracy_m >= 0),
  start_address text,
  started_by_account_id uuid not null references accounts (id),
  end_at timestamptz,
  end_odometer integer,
  end_lat double precision check (end_lat between -90 and 90),
  end_lng double precision check (end_lng between -180 and 180),
  end_accuracy_m double precision check (end_accuracy_m >= 0),
  end_address text,
  ended_by_account_id uuid references accounts (id),
  check ((start_lat is null) = (start_lng is null)),
  check ((end_lat is null) = (end_lng is null)),
  check ((end_at is null) = (end_odometer is null) and (end_at is null) = (ended_by_account_id is null)),
  check (end_odometer >= start_odometer)
);

create index company_trip_runs_revision_id_idx on company_trip_runs (revision_id);
create index company_trip_runs_started_by_idx on company_trip_runs (started_by_account_id);
create index company_trip_runs_ended_by_idx on company_trip_runs (ended_by_account_id);

create trigger company_trip_runs_audit
  after insert or update or delete on company_trip_runs
  for each row execute function write_audit_event();

alter table company_trip_runs enable row level security;
grant select on company_trip_runs to authenticated;

-- Whoever can see the trip: Admin and Scheduler, its Driver, and its requesters.
create policy company_trip_runs_select on company_trip_runs for select
  using (can_view_schedule(schedule_id));

-- A requester's Arrived / Leaving taps are stop taps too, so they see them.
drop policy stop_taps_select on stop_taps;
create policy stop_taps_select on stop_taps for select
  using (
    driver_id = (select auth.uid())
    or recorded_by_account_id = (select auth.uid())
    or (select current_account_role()) = 'Admin'
    or exists (select 1 from public.schedules s where s.id = schedule_id and s.kind = 'COMPANY' and public.can_view_schedule(s.id))
  );

-- The Driver's Start/End trip is for Daily trips only.
create function refuse_company_trip_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select kind from public.schedules where id = new.schedule_id) = 'COMPANY' then
    raise exception 'A Company trip is recorded by its requester, not in Attendance' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function refuse_company_trip_attendance() from public, anon, authenticated;

create trigger trip_attendance_daily_only
  before insert on trip_attendance
  for each row execute function refuse_company_trip_attendance();

-- The approved Company trip the caller may record, locked; raises otherwise.
create function company_trip_for_recording(p_schedule_id uuid, p_actor public.accounts)
returns public.schedule_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
begin
  if p_actor is null or p_actor.status <> 'Active' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule.id is null or v_schedule.kind <> 'COMPANY' then
    raise exception 'Trip not found' using errcode = 'P0002';
  end if;
  select * into v_revision from public.schedule_revisions
  where id = v_schedule.published_revision_id and status = 'APPROVED';
  if v_revision.id is null or (
    p_actor.role <> 'Admin' and not exists (
      select 1 from public.revision_requests rr join public.requests r on r.id = rr.request_id
      where rr.revision_id = v_revision.id and r.owner_account_id = p_actor.id
    )
  ) then
    raise exception 'Trip not found' using errcode = 'P0002';
  end if;
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This trip is no longer active' using errcode = '22023';
  end if;
  if p_actor.role = 'Admin' then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;
  return v_revision;
end;
$$;

revoke execute on function company_trip_for_recording(uuid, public.accounts) from public, anon, authenticated;

create function check_tap_location(p_lat double precision, p_lng double precision, p_accuracy_m double precision)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if (p_lat is null) <> (p_lng is null)
     or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m < 0 then
    raise exception 'That location isn''t valid' using errcode = '22023';
  end if;
end;
$$;

-- Start trip, with the starting odometer.
create function start_company_trip(
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
  if p_odometer is null or p_odometer < 0 then
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

-- Arrived ('ARRIVE') at a stop, or Leaving ('LEAVE') it, in route order.
-- The last stop's arrival is End trip.
create function record_company_stop(
  p_schedule_id uuid,
  p_leg_id uuid,
  p_kind text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_address text default null
)
returns public.stop_taps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_revision public.schedule_revisions;
  v_run public.company_trip_runs;
  v_leg public.schedule_legs;
  v_last integer;
  v_destination public.destination_locations;
  v_row public.stop_taps;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  v_revision := public.company_trip_for_recording(p_schedule_id, v_actor);
  if p_kind is null or p_kind not in ('ARRIVE', 'LEAVE') then
    raise exception 'Choose Arrived or Leaving' using errcode = '22023';
  end if;
  perform public.check_tap_location(p_lat, p_lng, p_accuracy_m);

  select * into v_leg from public.schedule_legs where id = p_leg_id and revision_id = v_revision.id;
  if v_leg.id is null then
    raise exception 'That stop isn''t on this trip any more' using errcode = 'P0002';
  end if;
  select * into v_row from public.stop_taps where leg_id = p_leg_id and kind = p_kind;
  if found then
    return v_row;
  end if;

  select * into v_run from public.company_trip_runs where schedule_id = p_schedule_id;
  if v_run.id is null then
    raise exception 'Tap Start trip first' using errcode = '22023';
  end if;
  if v_run.end_at is not null then
    raise exception 'This trip has ended' using errcode = '22023';
  end if;
  select max(leg_no) into v_last from public.schedule_legs where revision_id = v_revision.id;
  if v_leg.leg_no = v_last then
    raise exception 'Tap End trip on arriving at the last stop' using errcode = '22023';
  end if;
  -- In route order: Arrived at a stop after Leaving the one before it; Leaving after Arrived.
  if p_kind = 'ARRIVE' and v_leg.leg_no > 1 and not exists (
    select 1 from public.stop_taps t join public.schedule_legs l on l.id = t.leg_id
    where l.revision_id = v_revision.id and l.leg_no = v_leg.leg_no - 1 and t.kind = 'LEAVE'
  ) then
    raise exception 'Tap Leaving the stop before this one first' using errcode = '22023';
  end if;
  if p_kind = 'LEAVE' and not exists (select 1 from public.stop_taps where leg_id = p_leg_id and kind = 'ARRIVE') then
    raise exception 'Tap Arrived at this stop first' using errcode = '22023';
  end if;

  select * into v_destination from public.destination_locations where destination_id = v_leg.destination_id;
  perform set_config('kova.audit_action', 'stop.' || lower(p_kind), true);
  insert into public.stop_taps (
    schedule_id, revision_id, leg_id, driver_id, kind,
    lat, lng, accuracy_m, distance_m, address, recorded_by_account_id
  ) values (
    p_schedule_id, v_revision.id, v_leg.id, v_revision.driver_id, p_kind,
    p_lat, p_lng, p_accuracy_m, public.distance_m(p_lat, p_lng, v_destination.lat, v_destination.lng),
    case when p_lat is null then null else nullif(left(trim(p_address), 300), '') end, v_actor.id
  ) returning * into v_row;
  return v_row;
end;
$$;

-- End trip on arriving at the last stop, with the ending odometer (not
-- lower than the start). Submits the trip for the Admin's review.
create function end_company_trip(
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
  ) then
    raise exception 'Tap Leaving the stop before the last one first' using errcode = '22023';
  end if;
  if p_odometer is null or p_odometer < v_run.start_odometer then
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

revoke execute on function start_company_trip(uuid, integer, double precision, double precision, double precision, text) from public, anon;
grant execute on function start_company_trip(uuid, integer, double precision, double precision, double precision, text) to authenticated;
revoke execute on function record_company_stop(uuid, uuid, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function record_company_stop(uuid, uuid, text, double precision, double precision, double precision, text) to authenticated;
revoke execute on function end_company_trip(uuid, integer, double precision, double precision, double precision, text) from public, anon;
grant execute on function end_company_trip(uuid, integer, double precision, double precision, double precision, text) to authenticated;

-- Same as 0046, except a Company trip's Start and End come from its run
-- (it has no leg back to ANONANG, so End trip is the last stop's TIME IN).
create or replace function trip_times_missing(p_schedule_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with kind as (
    select s.kind from public.schedules s where s.id = p_schedule_id
  ),
  legs as (
    select l.id, l.is_final,
      lag(l.id) over (order by l.leg_no) as previous_id,
      row_number() over (order by l.leg_no) as position,
      count(*) over () as total
    from public.schedule_legs l
    join public.schedules s on s.published_revision_id = l.revision_id
    where s.id = p_schedule_id
  ),
  cells as (
    select legs.id, 'OUT' as field,
      case when legs.position = 1
        then case when (select kind from kind) = 'COMPANY'
          then (select r.start_at from public.company_trip_runs r where r.schedule_id = p_schedule_id)
          else (select a.start_at from public.trip_attendance a where a.schedule_id = p_schedule_id) end
        else (select t.at from public.stop_taps t where t.leg_id = legs.previous_id and t.kind = 'LEAVE')
      end as tapped_at
    from legs
    union all
    select legs.id, 'IN',
      case
        when legs.is_final then (select a.end_at from public.trip_attendance a where a.schedule_id = p_schedule_id)
        when (select kind from kind) = 'COMPANY' and legs.position = legs.total
          then (select r.end_at from public.company_trip_runs r where r.schedule_id = p_schedule_id)
        else (select t.at from public.stop_taps t where t.leg_id = legs.id and t.kind = 'ARRIVE')
      end
    from legs
  )
  select count(*)::integer from cells
  where tapped_at is null
    and not exists (
      select 1 from public.trip_time_corrections c where c.leg_id = cells.id and c.field = cells.field
    );
$$;

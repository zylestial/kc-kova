-- Stop reports (owner's request, 2026-10-16): at a stop, whoever records
-- the trip (the Driver on a Daily trip, the requester on a Company trip,
-- 0055) can report why it can't go as planned, and move on:
--
--   NOT_AVAILABLE     nobody / nothing there for pickup or drop-off: missed
--   WRONG_ADDRESS     can't be reached, or closed: missed
--   ROAD_BLOCKED      road blocked, flood, weather: Skip this stop (missed)
--                     or Wait (report only)
--   VEHICLE_PROBLEM   breakdown, flat tire: pauses the trip; no stop taps
--                     until Resume trip (End trip still works)
--   OTHER             report only
--
-- A missed stop needs no Arrived / Leaving: trip_times_missing leaves its
-- Time In and the next leg's Time Out out, and a Company trip may pass it
-- in route order. Schedulers and Admins are told (STOP_REPORTED); the
-- Scheduler then handles it on Scheduling. A report is a problem report
-- (0017) tied to a leg, so it shows wherever problems do.

alter table problem_reports
  -- No foreign key: an approved change (0060) may later remove the leg.
  add column leg_id uuid,
  add column kind text not null default 'OTHER'
    check (kind in ('NOT_AVAILABLE', 'WRONG_ADDRESS', 'ROAD_BLOCKED', 'VEHICLE_PROBLEM', 'OTHER')),
  add column missed boolean not null default false,
  -- Who reported it: the Driver, a Company trip's requester, or an Admin.
  add column reported_by_account_id uuid references accounts (id),
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add column accuracy_m double precision check (accuracy_m >= 0),
  add constraint problem_reports_missed_has_leg check (not missed or leg_id is not null),
  add constraint problem_reports_position_pair check ((lat is null) = (lng is null)),
  -- A stop report's note is optional; a whole-trip report (0017) still needs one.
  drop constraint problem_reports_note_check,
  add constraint problem_reports_note_check check (leg_id is not null or length(trim(note)) > 0);

create index problem_reports_leg_id_idx on problem_reports (leg_id);
create index problem_reports_reported_by_idx on problem_reports (reported_by_account_id);
-- One missed report per stop.
create unique index problem_reports_one_missed_per_leg on problem_reports (leg_id) where missed;

-- A Company trip's requester sees the reports they made.
drop policy problem_reports_select on problem_reports;
create policy problem_reports_select on problem_reports for select
  using (
    driver_id = (select auth.uid())
    or reported_by_account_id = (select auth.uid())
    or (select current_account_role()) in ('Admin', 'Scheduler')
  );

-- Set by a Vehicle problem report, cleared by Resume trip.
alter table schedules add column paused_at timestamptz;

-- Internal: the leg was reported missed.
create function leg_missed(p_leg_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (select 1 from public.problem_reports where leg_id = p_leg_id and missed);
$$;

revoke execute on function leg_missed(uuid) from public, anon, authenticated;

-- Internal: notifies every active Scheduler (beside notify_admins, 0035).
create function notify_schedulers(
  p_type text,
  p_message text,
  p_request_id uuid default null,
  p_schedule_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scheduler_id uuid;
begin
  for v_scheduler_id in select id from public.accounts where role = 'Scheduler' and status = 'Active' loop
    perform public.notify(v_scheduler_id, p_type, p_message, p_request_id, p_schedule_id);
  end loop;
end;
$$;

revoke execute on function notify_schedulers(text, text, uuid, uuid) from public, anon, authenticated;

-- Internal: the published version of a trip on the road the caller records,
-- locked: the Driver on a Daily trip (or an Admin for them), the requester
-- on a Company trip (company_trip_for_recording, 0055). Raises otherwise.
create function trip_for_reporting(p_schedule_id uuid, p_actor public.accounts)
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
  if v_schedule.id is null then
    raise exception 'Trip not found' using errcode = 'P0002';
  end if;
  if v_schedule.kind = 'COMPANY' then
    v_revision := public.company_trip_for_recording(p_schedule_id, p_actor);
  else
    select * into v_revision from public.schedule_revisions
    where id = v_schedule.published_revision_id and status = 'APPROVED';
    if v_revision.id is null or (v_revision.driver_id <> p_actor.id and p_actor.role <> 'Admin') then
      raise exception 'Trip not found' using errcode = 'P0002';
    end if;
    if v_schedule.status <> 'ACTIVE' then
      raise exception 'This trip is no longer active' using errcode = '22023';
    end if;
    if p_actor.role = 'Admin' then
      perform set_config('kova.audit_is_override', 'true', true);
    end if;
  end if;
  if not public.trip_started(p_schedule_id) then
    raise exception 'Tap Start trip first' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_attendance where schedule_id = p_schedule_id and end_at is not null)
     or exists (select 1 from public.company_trip_runs where schedule_id = p_schedule_id and end_at is not null) then
    raise exception 'This trip has ended' using errcode = '22023';
  end if;
  return v_revision;
end;
$$;

revoke execute on function trip_for_reporting(uuid, public.accounts) from public, anon, authenticated;

-- Reports a problem at one stop of a trip on the road (see the top).
-- p_skip: for a blocked road, skip the stop (missed) rather than wait.
create function report_stop(
  p_schedule_id uuid,
  p_leg_id uuid,
  p_kind text,
  p_note text default '',
  p_skip boolean default false,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null
)
returns public.problem_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_revision public.schedule_revisions;
  v_schedule public.schedules;
  v_leg public.schedule_legs;
  v_missed boolean;
  v_note text := coalesce(trim(p_note), '');
  v_report public.problem_reports;
  v_label text;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  v_revision := public.trip_for_reporting(p_schedule_id, v_actor);
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if p_kind is null or p_kind not in ('NOT_AVAILABLE', 'WRONG_ADDRESS', 'ROAD_BLOCKED', 'VEHICLE_PROBLEM', 'OTHER') then
    raise exception 'Choose what happened' using errcode = '22023';
  end if;
  perform public.check_tap_location(p_lat, p_lng, p_accuracy_m);

  select * into v_leg from public.schedule_legs where id = p_leg_id and revision_id = v_revision.id;
  if v_leg.id is null then
    raise exception 'That stop isn''t on this trip any more' using errcode = 'P0002';
  end if;
  if v_leg.is_final then
    raise exception 'Report the way back to ANONANG as a problem with the trip' using errcode = '22023';
  end if;

  v_missed := p_kind in ('NOT_AVAILABLE', 'WRONG_ADDRESS') or (p_kind = 'ROAD_BLOCKED' and coalesce(p_skip, false));
  if v_missed and public.leg_missed(v_leg.id) then
    raise exception 'This stop was already reported missed' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'problem.report_stop', true);
  insert into public.problem_reports (
    schedule_id, revision_id, driver_id, note, leg_id, kind, missed, reported_by_account_id, lat, lng, accuracy_m
  ) values (
    p_schedule_id, v_revision.id, v_revision.driver_id, left(v_note, 500), v_leg.id, p_kind, v_missed, v_actor.id,
    p_lat, p_lng, p_accuracy_m
  ) returning * into v_report;

  if p_kind = 'VEHICLE_PROBLEM' then
    update public.schedules set paused_at = coalesce(paused_at, now()) where id = p_schedule_id;
  end if;

  v_label := case p_kind
    when 'NOT_AVAILABLE' then 'Not available'
    when 'WRONG_ADDRESS' then 'Wrong address or closed'
    when 'ROAD_BLOCKED' then case when v_missed then 'Road blocked, skipped' else 'Road blocked, waiting' end
    when 'VEHICLE_PROBLEM' then 'Vehicle problem, trip paused'
    else 'Problem' end;
  perform public.notify_schedulers(
    'STOP_REPORTED',
    format('%s at %s: %s''s trip on %s', v_label, v_leg.destination_name, v_revision.plate, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null, p_schedule_id
  );
  perform public.notify_admins(
    'STOP_REPORTED',
    format('%s at %s: %s''s trip on %s', v_label, v_leg.destination_name, v_revision.plate, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null, p_schedule_id
  );

  return v_report;
end;
$$;

revoke execute on function report_stop(uuid, uuid, text, text, boolean, double precision, double precision, double precision) from public, anon;
grant execute on function report_stop(uuid, uuid, text, text, boolean, double precision, double precision, double precision) to authenticated;

-- Resume trip after a Vehicle problem.
create function resume_trip(p_schedule_id uuid)
returns public.schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  perform public.trip_for_reporting(p_schedule_id, v_actor);
  perform set_config('kova.audit_action', 'trip.resume', true);
  update public.schedules set paused_at = null where id = p_schedule_id
  returning * into v_schedule;
  return v_schedule;
end;
$$;

revoke execute on function resume_trip(uuid) from public, anon;
grant execute on function resume_trip(uuid) to authenticated;

-- No Arrived / Leaving while the trip is paused.
create function refuse_tap_while_paused()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.schedules where id = new.schedule_id and paused_at is not null) then
    raise exception 'The trip is paused for a vehicle problem. Tap Resume trip first' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function refuse_tap_while_paused() from public, anon, authenticated;

create trigger stop_taps_not_while_paused
  before insert on stop_taps
  for each row execute function refuse_tap_while_paused();


-- record_company_stop: same as 0055, except a stop reported missed counts
-- as left for the next stop's Arrived.
create or replace function record_company_stop(
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
  -- In route order: Arrived at a stop after Leaving the one before it (or
  -- its being reported missed, 0061); Leaving after Arrived.
  if p_kind = 'ARRIVE' and v_leg.leg_no > 1 and not exists (
    select 1 from public.stop_taps t join public.schedule_legs l on l.id = t.leg_id
    where l.revision_id = v_revision.id and l.leg_no = v_leg.leg_no - 1 and t.kind = 'LEAVE'
  ) and not exists (
    select 1 from public.schedule_legs l
    where l.revision_id = v_revision.id and l.leg_no = v_leg.leg_no - 1 and public.leg_missed(l.id)
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

-- end_company_trip: same as 0055, except the stop before the last may have
-- been reported missed instead of left.
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

-- trip_times_missing: same as 0055, except a missed stop's Time In and the
-- next leg's Time Out aren't missing.
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
  join legs on legs.id = cells.id
  where tapped_at is null
    -- A missed stop has no Time In, and the leg after it no Time Out.
    and not (cells.field = 'IN' and public.leg_missed(cells.id))
    and not (cells.field = 'OUT' and legs.previous_id is not null and public.leg_missed(legs.previous_id))
    and not exists (
      select 1 from public.trip_time_corrections c where c.leg_id = cells.id and c.field = cells.field
    );
$$;


alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'REQUEST_SCHEDULED',
  'REQUEST_RETURNED',
  'REQUEST_SENT_BACK',
  'REQUEST_SPLIT',
  'REQUEST_MOVED',
  'REQUEST_CANCELLED',
  'CANCELLATION_DECLINED',
  'CANCELLATION_REQUESTED',
  'PROBLEM_REPORTED',
  'SCHEDULE_SUBMITTED',
  'SCHEDULE_RETURNED',
  'TRIP_PUBLISHED',
  'TRIP_CHANGED',
  'STOP_REPORTED'
));

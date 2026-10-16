-- Company trip planner (Company Trip Flow prototype, step "Plan").
--
-- A schedule is now a Daily trip (as before) or a Company trip. A Company
-- trip:
--   * uses a vehicle that can be requested for company trips, and the
--     Company car Driver the requester picked (the vehicle's own Driver
--     doesn't matter);
--   * takes only Company Trip requests, all for one department, from one
--     starting point, with that same vehicle and Driver;
--   * starts its first leg at that starting point and ends at its last
--     destination, with no leg back to ANONANG;
--   * may share its vehicle with other Company trips the same day, as long
--     as their times don't overlap (schedule_reservations already refuses
--     an overlap; the one-trip-per-vehicle-day rule of 0048 is Daily only).
-- A Daily trip never uses a vehicle that can be requested for company
-- trips, nor a Company Trip request.

alter table schedules
  add column kind text not null default 'DAILY' check (kind in ('DAILY', 'COMPANY'));

-- Same as 0048, for Daily trips only.
create or replace function enforce_one_trip_per_vehicle_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date date;
  v_kind text;
  v_other uuid;
begin
  if new.status not in ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') then
    return new;
  end if;
  select schedule_date, kind into v_date, v_kind from public.schedules where id = new.schedule_id;
  if v_kind = 'COMPANY' then
    return new;
  end if;
  -- Two Schedulers saving the same vehicle and day at once queue here.
  perform pg_advisory_xact_lock(hashtext('vehicle-day:' || new.plate || ':' || v_date::text));

  select s.id into v_other
  from public.schedules s
  join public.schedule_revisions r on r.schedule_id = s.id
  where s.id <> new.schedule_id
    and s.status = 'ACTIVE'
    and s.kind = 'DAILY'
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

-- A Daily trip's vehicle is never one for company trips, and a Company
-- trip's always is.
create function enforce_schedule_kind_vehicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_company_trips boolean;
begin
  select kind into v_kind from public.schedules where id = new.schedule_id;
  select company_trips into v_company_trips from public.vehicles where plate = new.plate;
  if v_kind = 'DAILY' and v_company_trips then
    raise exception '% can be requested for company trips, so it isn''t used for Daily trips', new.plate using errcode = '22023';
  end if;
  if v_kind = 'COMPANY' and not coalesce(v_company_trips, false) then
    raise exception '% can''t be requested for company trips', new.plate using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function enforce_schedule_kind_vehicle() from public, anon, authenticated;

create trigger schedule_revisions_kind_vehicle
  before insert or update of plate on schedule_revisions
  for each row execute function enforce_schedule_kind_vehicle();

-- Which requests a trip may take: Daily ones on a Daily trip; on a Company
-- trip, Company Trip requests with its Driver, all for one department and
-- from one starting point.
create function enforce_company_trip_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_revision public.schedule_revisions;
  v_request public.requests;
  v_group public.request_groups;
  v_label text;
begin
  select * into v_revision from public.schedule_revisions where id = new.revision_id;
  select kind into v_kind from public.schedules where id = v_revision.schedule_id;
  select * into v_request from public.requests where id = new.request_id;
  select * into v_group from public.request_groups where id = v_request.group_id;
  v_label := coalesce(v_group.number || '-' || v_request.stop_letter, 'A request');

  if v_kind = 'DAILY' then
    if v_group.form_type = 'COMPANY' then
      raise exception '% is a Company Trip; plan it on the Company trip planner', v_label using errcode = '22023';
    end if;
    return new;
  end if;

  if v_group.id is null or v_group.form_type <> 'COMPANY' then
    raise exception '% isn''t a Company Trip, so it can''t go on a company trip', v_label using errcode = '22023';
  end if;
  if v_group.driver_id is distinct from v_revision.driver_id then
    raise exception '% asked for another Driver', v_label using errcode = '22023';
  end if;
  if exists (
    select 1 from public.revision_requests rr
    join public.requests r on r.id = rr.request_id
    join public.request_groups g on g.id = r.group_id
    where rr.revision_id = new.revision_id and rr.request_id <> new.request_id
      and g.department_id is distinct from v_group.department_id
  ) then
    raise exception 'A company trip is for one department. % is for %', v_label, v_group.department_name using errcode = '22023';
  end if;
  if exists (
    select 1 from public.revision_requests rr
    join public.requests r on r.id = rr.request_id
    join public.request_groups g on g.id = r.group_id
    where rr.revision_id = new.revision_id and rr.request_id <> new.request_id
      and g.starting_point_id is distinct from v_group.starting_point_id
  ) then
    raise exception 'A company trip starts from one place. % starts from %', v_label, v_group.starting_point_name using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function enforce_company_trip_requests() from public, anon, authenticated;

create trigger revision_requests_company_trip
  after insert on revision_requests
  for each row execute function enforce_company_trip_requests();

-- Same as 0034, except a Company trip's Driver comes from its requests.
create or replace function save_schedule_draft(
  p_schedule_id uuid,
  p_expected_row_version integer,
  p_schedule_date date,
  p_plate text,
  p_request_ids uuid[],
  p_legs jsonb
) returns public.schedule_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_vehicle public.vehicles;
  v_driver public.accounts;
  v_request_ids uuid[];
  v_request public.requests;
  v_is_override boolean := false;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Not authorized to edit schedules' using errcode = '42501';
  end if;

  perform set_config('kova.audit_action', 'schedule.save', true);

  if p_schedule_id is null then
    -- Admin creating a schedule is acting as Scheduler (view-as override).
    -- Set the override flag before the schedules INSERT below so that
    -- row's own audit event carries it too, not just later ones.
    if v_actor.role = 'Admin' then
      v_is_override := true;
      perform set_config('kova.audit_is_override', 'true', true);
    end if;
    if p_schedule_date is null then
      raise exception 'Select a date' using errcode = '22023';
    end if;
    insert into public.schedules (schedule_date, created_by_account_id)
    values (p_schedule_date, v_actor.id)
    returning * into v_schedule;
  else
    select * into v_schedule from public.schedules where id = p_schedule_id for update;
    if v_schedule is null then
      raise exception 'Schedule not found' using errcode = 'P0002';
    end if;
    if v_schedule.status <> 'ACTIVE' then
      raise exception 'This schedule is no longer active' using errcode = '22023';
    end if;
    if p_schedule_date is not null and p_schedule_date <> v_schedule.schedule_date then
      raise exception 'A schedule''s date can''t be changed' using errcode = '22023';
    end if;
    if exists (select 1 from public.trip_completions where schedule_id = v_schedule.id) then
      raise exception 'This trip has already been submitted by the Driver and can''t be revised' using errcode = '22023';
    end if;

    select * into v_revision from public.schedule_revisions
    where schedule_id = v_schedule.id and status in ('DRAFT', 'SUBMITTED', 'RETURNED')
    for update;

    if v_revision.id is not null then
      if v_actor.role = 'Scheduler' and v_revision.status = 'SUBMITTED' then
        raise exception 'This schedule is waiting for Admin approval' using errcode = '22023';
      end if;
      -- Admin editing a not-yet-submitted revision is acting as Scheduler
      -- (override); editing a SUBMITTED one is Admin's pre-existing power.
      if v_actor.role = 'Admin' and v_revision.status <> 'SUBMITTED' then
        v_is_override := true;
        perform set_config('kova.audit_is_override', 'true', true);
      end if;
      if v_revision.row_version is distinct from p_expected_row_version then
        raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = 'PT409';
      end if;
    elsif v_actor.role = 'Admin' then
      -- No active revision on an approved schedule: Admin starting a
      -- proposed revision here is acting as Scheduler (override).
      v_is_override := true;
      perform set_config('kova.audit_is_override', 'true', true);
    end if;
  end if;

  select * into v_vehicle from public.vehicles where plate = p_plate;
  if v_vehicle is null or v_vehicle.status <> 'Active' then
    raise exception 'Select an active Vehicle' using errcode = '22023';
  end if;
  -- Said before the Driver check, which a company trip vehicle would fail first.
  if v_schedule.kind = 'DAILY' and v_vehicle.company_trips then
    raise exception '% can be requested for company trips, so it isn''t used for Daily trips', v_vehicle.plate using errcode = '22023';
  end if;
  if v_schedule.kind = 'COMPANY' then
    -- The Driver the requester picked (every request on the trip shares it;
    -- revision_requests_company_trip checks).
    select a.* into v_driver
    from public.requests r
    join public.request_groups g on g.id = r.group_id
    join public.accounts a on a.id = g.driver_id
    where r.id = any(p_request_ids)
    order by r.id
    limit 1;
    if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' or v_driver.driver_type <> 'Company car' then
      raise exception 'The Driver the requester picked is no longer an active Company car driver' using errcode = '22023';
    end if;
  else
    select * into v_driver from public.accounts where id = v_vehicle.assigned_driver_id;
    if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' then
      raise exception 'This vehicle has no Driver assigned' using errcode = '22023';
    end if;
  end if;

  select coalesce(array_agg(distinct id), '{}') into v_request_ids from unnest(p_request_ids) as ids (id);
  if cardinality(v_request_ids) = 0 then
    raise exception 'Include at least one request' using errcode = '22023';
  end if;
  perform 1 from public.requests where id = any(v_request_ids) order by id for update;
  if (select count(*) from public.requests where id = any(v_request_ids)) <> cardinality(v_request_ids) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  for v_request in select * from public.requests where id = any(v_request_ids) loop
    if v_request.status <> 'ACTIVE' then
      raise exception 'A selected request has been cancelled' using errcode = '22023';
    end if;
    if v_request.requested_date <> v_schedule.schedule_date then
      raise exception 'A selected request is for a different date' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.schedule_requests
      where request_id = v_request.id and active and schedule_id <> v_schedule.id
    ) then
      raise exception 'A selected request is already in another schedule' using errcode = '23505';
    end if;
  end loop;

  if v_revision.id is null then
    insert into public.schedule_revisions (
      schedule_id, version, status, plate, driver_id, driver_name, created_by_account_id
    ) values (
      v_schedule.id,
      (select coalesce(max(version), 0) + 1 from public.schedule_revisions where schedule_id = v_schedule.id),
      'DRAFT', v_vehicle.plate, v_driver.id, v_driver.name, v_actor.id
    ) returning * into v_revision;
  else
    update public.schedule_revisions set
      plate = v_vehicle.plate,
      driver_id = v_driver.id,
      driver_name = v_driver.name,
      status = case when status = 'RETURNED' then 'DRAFT' else status end,
      row_version = row_version + 1,
      updated_at = now()
    where id = v_revision.id
    returning * into v_revision;
  end if;

  perform public.write_revision_content(v_revision.id, v_schedule.schedule_date, v_request_ids, p_legs);
  perform public.sync_schedule_inclusions(v_schedule.id);
  update public.schedules set updated_at = now() where id = v_schedule.id;

  return v_revision;
end;
$$;


-- Same as 0036, except a Company trip starts at its starting point and has
-- no leg back to ANONANG.
create or replace function write_revision_content(
  p_revision_id uuid,
  p_schedule_date date,
  p_request_ids uuid[],
  p_legs jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legs jsonb := coalesce(p_legs, '[]'::jsonb);
  v_leg jsonb;
  v_no int := 0;
  v_prev_destination text := 'ANONANG';
  v_prev_in time(0);
  v_out time(0);
  v_in time(0);
  v_first_out time(0);
  v_last_in time(0);
  v_is_final boolean;
  v_final_seen boolean := false;
  v_destination public.booking_options;
  v_destination_id text;
  v_destination_name text;
  v_leg_id uuid;
  v_stop text;
  v_stops jsonb;
  v_first_stop public.request_destinations;
  v_request_destination public.request_destinations;
  v_out_text text;
  v_in_text text;
  v_all_timed boolean := true;
  v_kind text;
begin
  select s.kind into v_kind
  from public.schedule_revisions sr join public.schedules s on s.id = sr.schedule_id
  where sr.id = p_revision_id;
  if v_kind = 'COMPANY' then
    select g.starting_point_name into v_prev_destination
    from public.requests r join public.request_groups g on g.id = r.group_id
    where r.id = any(p_request_ids)
    order by r.id
    limit 1;
    v_prev_destination := coalesce(v_prev_destination, '');
  end if;

  if jsonb_typeof(v_legs) <> 'array' then
    raise exception 'Legs must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(v_legs) > 8 then
    raise exception 'A schedule can have at most 8 legs%', case when v_kind = 'COMPANY' then '' else ', including the final leg back to ANONANG' end using errcode = '22023';
  end if;

  delete from public.schedule_legs where revision_id = p_revision_id;
  delete from public.revision_requests where revision_id = p_revision_id;
  insert into public.revision_requests (revision_id, request_id)
  select p_revision_id, unnest(p_request_ids);

  for v_leg in select value from jsonb_array_elements(v_legs) loop
    v_no := v_no + 1;
    if v_final_seen then
      raise exception 'The final leg back to ANONANG must be the last leg' using errcode = '22023';
    end if;

    v_is_final := coalesce((v_leg ->> 'isFinal')::boolean, false);
    v_stops := coalesce(v_leg -> 'stops', '[]'::jsonb);

    -- A leg's times may both be left blank while saving a draft (checked
    -- before submit by assert_revision_complete); one filled in without the
    -- other, or filled in badly, is still rejected here.
    v_out_text := coalesce(v_leg ->> 'plannedTimeOut', '');
    v_in_text := coalesce(v_leg ->> 'plannedTimeIn', '');
    if v_out_text = '' and v_in_text = '' then
      v_out := null;
      v_in := null;
      v_all_timed := false;
    else
      if v_out_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_in_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Leg %: enter planned times as HH:MM', v_no using errcode = '22023';
      end if;
      v_out := v_out_text::time(0);
      v_in := v_in_text::time(0);
      if v_in <= v_out then
        raise exception 'Leg %: planned Time In must be after Time Out', v_no using errcode = '22023';
      end if;
      if v_prev_in is not null and v_out < v_prev_in then
        raise exception 'Leg %: planned Time Out can''t be before the previous leg''s Time In', v_no using errcode = '22023';
      end if;
    end if;

    if v_is_final and v_kind = 'COMPANY' then
      raise exception 'A Company Trip ends at its last destination; it has no leg back to ANONANG' using errcode = '22023';
    end if;
    if v_is_final then
      if jsonb_array_length(v_stops) > 0 then
        raise exception 'The final leg back to ANONANG has no request stops' using errcode = '22023';
      end if;
      v_destination_id := null;
      v_destination_name := 'ANONANG';
      v_final_seen := true;
    else
      v_first_stop := null;
      if jsonb_array_length(v_stops) > 0 then
        select * into v_first_stop from public.request_destinations
        where id = (v_stops ->> 0)::uuid;
      end if;

      -- v_first_stop.id (never null once found) rather than the row itself:
      -- a composite value's own "is not null" is true only when every field
      -- is non-null, and an Other stop's destination_id/purpose_id are null
      -- by design.
      if v_first_stop.id is not null and v_first_stop.destination_is_other then
        -- An Other-destination leg: derive the destination from the stop
        -- itself, never from booking_options (there is no id to look up).
        v_destination_id := null;
        v_destination_name := v_first_stop.destination_name;
      else
        select * into v_destination from public.booking_options
        where "group" = 'destinations' and id = v_leg ->> 'destinationId';
        if v_destination is null then
          raise exception 'Leg %: choose a destination', v_no using errcode = '22023';
        end if;
        -- A leg with no request stops is a new selection, so it needs an
        -- Active option; a leg serving requests uses whatever they asked for.
        if jsonb_array_length(v_stops) = 0 and v_destination.status <> 'Active' then
          raise exception 'Leg %: destination is not an active option', v_no using errcode = '22023';
        end if;
        if jsonb_array_length(v_stops) = 0 and not v_destination.is_other_stop then
          raise exception 'Leg %: a destination with no request needs to be marked as an other stop', v_no using errcode = '22023';
        end if;
        v_destination_id := v_destination.id;
        v_destination_name := v_destination.name;
      end if;
    end if;

    insert into public.schedule_legs (
      revision_id, leg_no, origin, destination_id, destination_name,
      planned_time_out, planned_time_in, contact_name, contact_number, is_final
    ) values (
      p_revision_id, v_no, v_prev_destination, v_destination_id, v_destination_name,
      v_out, v_in, coalesce(trim(v_leg ->> 'contactName'), ''), coalesce(trim(v_leg ->> 'contactNumber'), ''),
      v_is_final
    ) returning id into v_leg_id;

    for v_stop in select jsonb_array_elements_text(v_stops) loop
      select * into v_request_destination from public.request_destinations where id = v_stop::uuid;
      if v_request_destination is null or not v_request_destination.active
         or not (v_request_destination.request_id = any(p_request_ids)) then
        raise exception 'Leg %: a stop belongs to a request that isn''t in this schedule', v_no using errcode = '22023';
      end if;
      if v_request_destination.destination_is_other then
        if v_destination_id is not null or v_request_destination.destination_name <> v_destination_name then
          raise exception 'Leg %: a stop''s destination doesn''t match the leg''s destination', v_no using errcode = '22023';
        end if;
      elsif v_request_destination.destination_id <> v_destination_id then
        raise exception 'Leg %: a stop''s destination doesn''t match the leg''s destination', v_no using errcode = '22023';
      end if;
      if exists (
        select 1 from public.leg_stops
        where revision_id = p_revision_id and request_destination_id = v_request_destination.id
      ) then
        raise exception 'Leg %: a request destination can only be served by one leg', v_no using errcode = '22023';
      end if;
      insert into public.leg_stops (leg_id, revision_id, request_destination_id)
      values (v_leg_id, p_revision_id, v_request_destination.id);
    end loop;

    v_prev_destination := v_destination_name;
    v_prev_in := v_in;
    v_first_out := coalesce(v_first_out, v_out);
    v_last_in := v_in;
  end loop;

  delete from public.schedule_reservations where revision_id = p_revision_id;
  if v_all_timed and v_first_out is not null then
    insert into public.schedule_reservations (revision_id, schedule_id, plate, driver_id, period)
    select sr.id, sr.schedule_id, sr.plate, sr.driver_id,
      tstzrange(
        (p_schedule_date + v_first_out) at time zone 'Asia/Manila',
        (p_schedule_date + v_last_in) at time zone 'Asia/Manila',
        '[)'
      )
    from public.schedule_revisions sr
    where sr.id = p_revision_id;
  end if;
exception
  when exclusion_violation then
    raise exception 'This vehicle or Driver is already reserved for part of that time' using errcode = '23P01';
end;
$$;


-- Same as 0033, except only a Daily trip needs the leg back to ANONANG.
create or replace function assert_revision_complete(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (select 1 from public.revision_requests where revision_id = p_revision_id) then
    raise exception 'Include at least one request' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.revision_requests rr
    join public.requests r on r.id = rr.request_id
    where rr.revision_id = p_revision_id and r.status <> 'ACTIVE'
  ) then
    raise exception 'A request in this schedule has been cancelled; remove it first' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.schedule_legs
    where revision_id = p_revision_id and (planned_time_out is null or planned_time_in is null)
  ) then
    raise exception 'Enter planned Time Out and Time In for every leg' using errcode = '22023';
  end if;
  if (select s.kind from public.schedule_revisions sr join public.schedules s on s.id = sr.schedule_id
      where sr.id = p_revision_id) = 'DAILY' and not exists (
    select 1 from public.schedule_legs l
    where l.revision_id = p_revision_id and l.is_final
      and l.leg_no = (select max(leg_no) from public.schedule_legs where revision_id = p_revision_id)
  ) then
    raise exception 'Add the final leg back to ANONANG' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.revision_requests rr
    join public.request_destinations rd on rd.request_id = rr.request_id and rd.active
    where rr.revision_id = p_revision_id
      and not exists (
        select 1 from public.leg_stops ls
        where ls.revision_id = p_revision_id and ls.request_destination_id = rd.id
      )
  ) then
    raise exception 'Every destination of every included request must be on a leg' using errcode = '22023';
  end if;
end;
$$;


-- Starts a Company trip for a day and saves its first draft; after that,
-- save_schedule_draft edits it like any other schedule. Scheduler, or
-- Admin acting as Scheduler.
create function create_company_trip(
  p_schedule_date date,
  p_plate text,
  p_request_ids uuid[],
  p_legs jsonb
) returns public.schedule_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Not authorized to edit schedules' using errcode = '42501';
  end if;
  if p_schedule_date is null then
    raise exception 'Select a date' using errcode = '22023';
  end if;
  perform set_config('kova.audit_action', 'schedule.save', true);
  if v_actor.role = 'Admin' then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;
  insert into public.schedules (schedule_date, created_by_account_id, kind)
  values (p_schedule_date, v_actor.id, 'COMPANY')
  returning * into v_schedule;
  return public.save_schedule_draft(v_schedule.id, null, p_schedule_date, p_plate, p_request_ids, p_legs);
end;
$$;

revoke execute on function create_company_trip(date, text, uuid[], jsonb) from public, anon;
grant execute on function create_company_trip(date, text, uuid[], jsonb) to authenticated;

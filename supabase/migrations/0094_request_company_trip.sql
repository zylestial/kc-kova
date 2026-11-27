-- Company trip v2: the request books the trip (owner's calls 2026-11-26/27).
-- There is no Scheduler step for Company trips any more. The requester
-- picks the vehicle (a company trip vehicle, or their own personal one),
-- the Driver, and the times: Time Out from the Main Office, the arrive and
-- leave time at each destination, and Time In (arriving at the last one).
-- Sending it creates the Company trip and sends it straight to the Admin.
--   * Return with comment goes back to the requester, who edits and resends.
--   * Editing an approved trip sends the new version to the Admin; the
--     approved one stays in force until then (as with any revision).
--   * No one is on two trips at once: the vehicle and Driver already
--     can't be (schedule_reservations); the requester and passenger
--     accounts are checked here too. Typed guests can't be.
-- The old paths (the Company request form and Scheduling's Company
-- planner) are refused below, so no Company trip is half in each model.

-- Everyone on a trip with a KOVA account: requester, Driver, passengers.
create function company_trip_people(p_revision_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.id) filter (where x.id is not null), '{}')
  from (
    select sr.driver_id as id from public.schedule_revisions sr where sr.id = p_revision_id
    union all
    select g.owner_account_id
    from public.revision_requests rr
    join public.requests r on r.id = rr.request_id
    join public.request_groups g on g.id = r.group_id
    where rr.revision_id = p_revision_id
    union all
    select p.account_id
    from public.revision_requests rr
    join public.requests r on r.id = rr.request_id
    join public.request_group_passengers p on p.group_id = r.group_id
    where rr.revision_id = p_revision_id
  ) x;
$$;

revoke execute on function company_trip_people(uuid) from public, anon, authenticated;

-- Refuses a trip whose people are on another Company trip at an
-- overlapping time.
create function assert_people_free(p_revision_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mine public.schedule_reservations;
  v_people uuid[];
  v_clash record;
begin
  select * into v_mine from public.schedule_reservations where revision_id = p_revision_id;
  if v_mine.revision_id is null then
    return;
  end if;
  v_people := public.company_trip_people(p_revision_id);
  select a.name, lower(o.period) as starts_at, upper(o.period) as ends_at into v_clash
  from public.schedule_reservations o
  join public.schedules s on s.id = o.schedule_id and s.status = 'ACTIVE' and s.kind = 'COMPANY'
  cross join lateral unnest(public.company_trip_people(o.revision_id)) as p (id)
  join public.accounts a on a.id = p.id
  where o.schedule_id <> v_mine.schedule_id
    and o.period && v_mine.period
    and p.id = any(v_people)
  order by a.name
  limit 1;
  if v_clash.name is not null then
    raise exception '% is already on another company trip from % to %', v_clash.name,
      to_char(v_clash.starts_at at time zone 'Asia/Manila', 'FMHH12:MI AM'),
      to_char(v_clash.ends_at at time zone 'Asia/Manila', 'FMHH12:MI AM')
      using errcode = '23P01';
  end if;
end;
$$;

revoke execute on function assert_people_free(uuid) from public, anon, authenticated;

-- What is already booked on a day, for the request form: each Company
-- trip's vehicle, times and people, so it can show which vehicles are free
-- and grey out people already on a trip. p_except_group leaves out the
-- request being edited.
create function company_trip_busy(p_date date, p_except_group uuid default null)
returns table (
  schedule_id uuid,
  plate text,
  owner_name text,
  starts_at text,
  ends_at text,
  account_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if not public.can_request_company(v_actor) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select distinct on (o.revision_id)
    o.schedule_id, o.plate, g.owner_name,
    to_char(lower(o.period) at time zone 'Asia/Manila', 'HH24:MI'),
    to_char(upper(o.period) at time zone 'Asia/Manila', 'HH24:MI'),
    public.company_trip_people(o.revision_id)
  from public.schedule_reservations o
  join public.schedules s on s.id = o.schedule_id and s.status = 'ACTIVE' and s.kind = 'COMPANY'
  join public.revision_requests rr on rr.revision_id = o.revision_id
  join public.requests r on r.id = rr.request_id
  join public.request_groups g on g.id = r.group_id
  where s.schedule_date = p_date
    and g.id is distinct from p_except_group
  order by o.revision_id;
end;
$$;

revoke execute on function company_trip_busy(date, uuid) from public, anon;
grant execute on function company_trip_busy(date, uuid) to authenticated;

-- The Company trip a request is on (one request = one trip).
create function company_trip_schedule_of(p_group_id uuid)
returns public.schedules
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.schedules s
  where s.kind = 'COMPANY' and s.status = 'ACTIVE'
    and exists (
      select 1 from public.schedule_requests sr
      join public.requests r on r.id = sr.request_id
      where sr.schedule_id = s.id and sr.active and r.group_id = p_group_id
    )
  limit 1;
$$;

revoke execute on function company_trip_schedule_of(uuid) from public, anon, authenticated;

create function parse_hhmm(p_text text, p_label text)
returns time(0)
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(p_text, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Enter the % as HH:MM', p_label using errcode = '22023';
  end if;
  return p_text::time(0);
end;
$$;

revoke execute on function parse_hhmm(text, text) from public, anon, authenticated;

-- Sends a new Company trip request (p_group_id null) or resends an edited
-- one. p_input:
--   date, departmentId, vehiclePlate, driverId, purpose, fleetCard,
--   priority ('REGULAR' | 'URGENT'), urgentReasonId, timeOut ('HH:MM'),
--   stops: [{ destinationId, arriveAt, leaveAt }]  (the last stop's
--     arriveAt is Time In; its leaveAt is ignored),
--   passengers: [{ accountId } | { guestName }]
create function request_company_trip(p_group_id uuid, p_expected_row_version integer, p_input jsonb)
returns public.request_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_existing public.request_groups;
  v_group public.request_groups;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_date date;
  v_choice record;
  v_start record;
  v_dept record;
  v_urgent record;
  v_vehicle public.vehicles;
  v_driver public.accounts;
  v_purpose text := trim(coalesce(p_input ->> 'purpose', ''));
  v_fleet text := trim(coalesce(p_input ->> 'fleetCard', ''));
  v_priority text := coalesce(nullif(p_input ->> 'priority', ''), 'REGULAR');
  v_stops jsonb := coalesce(p_input -> 'stops', '[]');
  v_passengers jsonb := coalesce(p_input -> 'passengers', '[]');
  v_count integer;
  v_i integer;
  v_stop jsonb;
  v_pass jsonb;
  v_dest record;
  v_old uuid[];
  v_request_id uuid;
  v_request_ids uuid[] := '{}';
  v_dest_ids uuid[] := '{}';
  v_dest_row uuid;
  v_out time(0);
  v_prev_leave time(0);
  v_arrive time(0);
  v_legs jsonb := '[]';
  v_pass_id uuid;
  v_guest text;
  v_seen uuid[] := '{}';
  v_old_request public.requests;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if not public.can_request_company(v_actor) then
    raise exception 'Not authorized to request company trips' using errcode = '42501';
  end if;

  if p_group_id is not null then
    select * into v_existing from public.request_groups where id = p_group_id for update;
    if v_existing.id is null or v_existing.owner_account_id <> v_actor.id or v_existing.form_type <> 'COMPANY' then
      raise exception 'Request not found' using errcode = 'P0002';
    end if;
    if v_existing.row_version <> p_expected_row_version then
      raise exception 'This request was changed elsewhere. Reload it and try again' using errcode = 'PT409';
    end if;
    v_schedule := public.company_trip_schedule_of(p_group_id);
    if v_schedule.id is null then
      raise exception 'This request was cancelled, so it can''t be changed' using errcode = '22023';
    end if;
    perform 1 from public.schedules where id = v_schedule.id for update;
    if public.trip_started(v_schedule.id) or exists (select 1 from public.trip_completions where schedule_id = v_schedule.id) then
      raise exception 'This trip has started, so it can''t be changed' using errcode = '22023';
    end if;
  end if;

  -- Date
  v_date := nullif(p_input ->> 'date', '')::date;
  if v_date is null then
    raise exception 'Select a date' using errcode = '22023';
  end if;
  if v_date < v_today and v_actor.role <> 'Admin' and v_date is distinct from v_existing.requested_date then
    raise exception 'That date has passed. Choose today or a later date' using errcode = '22023';
  end if;
  if v_schedule.id is not null and v_date <> v_schedule.schedule_date and v_schedule.published_revision_id is not null then
    raise exception 'This trip is already approved for %. To change the date, cancel it and send a new request',
      to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY') using errcode = '22023';
  end if;

  -- Starts at the Main Office (the starting point choice).
  select o.id, o.name into v_start from public.booking_options o
  where o."group" = 'starting_points' and o.status = 'Active'
  order by (o.id = 'start-office') desc, o.name
  limit 1;
  if v_start.id is null then
    if v_existing.starting_point_id is not null then
      select v_existing.starting_point_id as id, v_existing.starting_point_name as name into v_start;
    else
      raise exception 'Ask an Admin to add the Main Office under Starting points' using errcode = '22023';
    end if;
  end if;

  select * into v_dept from public.resolve_choice('projects', p_input ->> 'departmentId', 'Department / Project Site',
    v_existing.department_id, v_existing.department_name);

  -- Purpose, fleet card, Regular or Urgent
  if v_purpose = '' then
    raise exception 'Add the purpose of the trip' using errcode = '22023';
  end if;
  if char_length(v_purpose) > 300 then
    raise exception 'The purpose can be at most 300 characters' using errcode = '22023';
  end if;
  if v_fleet !~ '^[0-9]{4}$' then
    raise exception 'Enter the last 4 digits of the Fleet Card' using errcode = '22023';
  end if;
  if v_priority not in ('REGULAR', 'URGENT') then
    raise exception 'Choose Regular or Urgent' using errcode = '22023';
  end if;
  if v_priority = 'URGENT' then
    select * into v_urgent from public.resolve_choice('urgent_reasons', p_input ->> 'urgentReasonId', 'Reason it''s urgent',
      v_existing.urgent_reason_id, v_existing.urgent_reason_name);
  else
    select null::text as id, ''::text as name into v_urgent;
  end if;

  -- Vehicle and Driver
  select * into v_vehicle from public.vehicles
  where plate = public.resolve_request_vehicle(p_input ->> 'vehiclePlate', v_existing.vehicle_plate);
  if v_vehicle.plate is null then
    raise exception 'Select a vehicle' using errcode = '22023';
  end if;
  if v_vehicle.owner_account_id is not null then
    -- A personal vehicle is driven by its owner.
    v_driver := v_actor;
    if not public.can_drive_company(v_driver) then
      raise exception 'Your account can''t drive company trips any more, so pick a company vehicle and a Driver' using errcode = '22023';
    end if;
  else
    if nullif(p_input ->> 'driverId', '') is null then
      raise exception 'Select a Driver' using errcode = '22023';
    end if;
    select * into v_driver from public.accounts where id = (p_input ->> 'driverId')::uuid;
    if not public.can_drive_company(v_driver) then
      raise exception 'Select someone who can drive company trips' using errcode = '22023';
    end if;
  end if;

  -- Destinations
  if jsonb_typeof(v_stops) <> 'array' or jsonb_array_length(v_stops) = 0 then
    raise exception 'Add at least one destination' using errcode = '22023';
  end if;
  if jsonb_array_length(v_stops) > 8 then
    raise exception 'A company trip can have at most 8 destinations' using errcode = '22023';
  end if;
  v_out := public.parse_hhmm(p_input ->> 'timeOut', 'Time Out');

  -- Passengers
  if jsonb_typeof(v_passengers) <> 'array' then
    raise exception 'Passengers must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(v_passengers) > 15 then
    raise exception 'A trip can have at most 15 passengers' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'company_trip.request', true);

  -- The request
  if v_existing.id is null then
    insert into public.request_groups (
      owner_account_id, owner_name, form_type, requested_date,
      starting_point_id, starting_point_name, department_id, department_name,
      vehicle_plate, driver_id, driver_name,
      purpose_text, fleet_card_last4, priority, urgent_reason_id, urgent_reason_name
    ) values (
      v_actor.id, v_actor.name, 'COMPANY', v_date,
      v_start.id, v_start.name, v_dept.id, v_dept.name,
      v_vehicle.plate, v_driver.id, v_driver.name,
      v_purpose, v_fleet, v_priority, v_urgent.id, v_urgent.name
    ) returning * into v_group;
  else
    update public.request_groups set
      requested_date = v_date,
      starting_point_id = v_start.id,
      starting_point_name = v_start.name,
      department_id = v_dept.id,
      department_name = v_dept.name,
      vehicle_plate = v_vehicle.plate,
      driver_id = v_driver.id,
      driver_name = v_driver.name,
      supervisor_id = null, supervisor_name = '', head_id = null, head_name = '',
      site_officer = '', site_company = '',
      purpose_text = v_purpose,
      fleet_card_last4 = v_fleet,
      priority = v_priority,
      urgent_reason_id = v_urgent.id,
      urgent_reason_name = v_urgent.name,
      row_version = row_version + 1,
      updated_at = now()
    where id = v_existing.id
    returning * into v_group;
  end if;

  -- One stop per destination, in order. An edit reuses the stops it has,
  -- in order, and cancels any left over.
  select coalesce(array_agg(id order by stop_letter), '{}') into v_old
  from public.requests where group_id = v_group.id and status = 'ACTIVE';
  v_count := jsonb_array_length(v_stops);
  for v_i in 0 .. v_count - 1 loop
    v_stop := v_stops -> v_i;
    select o.id, o.name into v_dest from public.booking_options o
    where o."group" = 'destinations' and o.id = nullif(v_stop ->> 'destinationId', '')
      and o.status = 'Active' and not o.is_other_stop;
    if v_dest.id is null and v_i + 1 <= cardinality(v_old) then
      select rd.destination_id as id, rd.destination_name as name into v_dest
      from public.request_destinations rd
      where rd.request_id = v_old[v_i + 1] and rd.active and rd.destination_id = nullif(v_stop ->> 'destinationId', '');
    end if;
    if v_dest.id is null then
      raise exception 'Destination %: choose a destination from the list', v_i + 1 using errcode = '22023';
    end if;

    if v_i + 1 <= cardinality(v_old) then
      v_request_id := v_old[v_i + 1];
      update public.requests set
        requested_date = v_date,
        request_type = v_priority,
        project_id = v_dept.id,
        project_name = v_dept.name,
        project_is_other = false,
        vehicle_plate = v_vehicle.plate,
        urgent_reason_id = v_urgent.id,
        urgent_reason_name = v_urgent.name,
        sent_back_at = null,
        sent_back_by_account_id = null,
        sent_back_reason = '',
        row_version = row_version + 1,
        updated_at = now()
      where id = v_request_id;
      update public.request_destinations set active = false where request_id = v_request_id and active;
    else
      insert into public.requests (
        owner_account_id, owner_name, requested_date, request_type,
        project_id, project_name, project_is_other, vehicle_plate,
        group_id, stop_letter, urgent_reason_id, urgent_reason_name, flexibility
      ) values (
        v_actor.id, v_actor.name, v_date, v_priority,
        v_dept.id, v_dept.name, false, v_vehicle.plate,
        v_group.id, public.next_stop_letter(v_group.id), v_urgent.id, v_urgent.name, 'DAY'
      ) returning id into v_request_id;
    end if;

    -- Each stop carries the request's one purpose.
    insert into public.request_destinations (
      request_id, position, destination_id, destination_name, destination_is_other,
      purpose_id, purpose_name, purpose_is_other
    ) values (
      v_request_id, 1, v_dest.id, v_dest.name, false, null, v_purpose, true
    ) returning id into v_dest_row;
    v_request_ids := v_request_ids || v_request_id;
    v_dest_ids := v_dest_ids || v_dest_row;

    -- The leg to this destination: from Time Out (or leaving the previous
    -- one) to arriving here.
    v_arrive := public.parse_hhmm(v_stop ->> 'arriveAt', format('time you arrive at destination %s', v_i + 1));
    v_legs := v_legs || jsonb_build_array(jsonb_build_object(
      'destinationId', v_dest.id,
      'stops', jsonb_build_array(v_dest_row),
      'plannedTimeOut', to_char(coalesce(v_prev_leave, v_out), 'HH24:MI'),
      'plannedTimeIn', to_char(v_arrive, 'HH24:MI')
    ));
    if v_i < v_count - 1 then
      v_prev_leave := public.parse_hhmm(v_stop ->> 'leaveAt', format('time you leave destination %s', v_i + 1));
      if v_prev_leave < v_arrive then
        raise exception 'Destination %: you can''t leave before you arrive', v_i + 1 using errcode = '22023';
      end if;
    end if;
  end loop;
  for v_i in v_count + 1 .. cardinality(v_old) loop
    perform public.cancel_request_row(v_old[v_i], v_actor.id);
  end loop;

  -- Passengers
  delete from public.request_group_passengers where group_id = v_group.id;
  v_i := 0;
  for v_pass in select value from jsonb_array_elements(v_passengers) loop
    v_i := v_i + 1;
    v_pass_id := nullif(v_pass ->> 'accountId', '')::uuid;
    v_guest := left(trim(coalesce(v_pass ->> 'guestName', '')), 100);
    if v_pass_id is not null then
      if v_pass_id = v_actor.id or v_pass_id = v_driver.id or v_pass_id = any(v_seen) then
        continue;
      end if;
      if not exists (select 1 from public.accounts where id = v_pass_id and status = 'Active') then
        raise exception 'A passenger''s account isn''t active any more. Remove them and try again' using errcode = '22023';
      end if;
      v_seen := v_seen || v_pass_id;
      insert into public.request_group_passengers (group_id, position, account_id) values (v_group.id, v_i, v_pass_id);
    elsif v_guest <> '' then
      insert into public.request_group_passengers (group_id, position, guest_name) values (v_group.id, v_i, v_guest);
    end if;
  end loop;

  -- The trip
  if v_schedule.id is null then
    insert into public.schedules (schedule_date, created_by_account_id, kind)
    values (v_date, v_actor.id, 'COMPANY')
    returning * into v_schedule;
  elsif v_date <> v_schedule.schedule_date then
    update public.schedules set schedule_date = v_date, updated_at = now()
    where id = v_schedule.id
    returning * into v_schedule;
  end if;

  select * into v_revision from public.schedule_revisions
  where schedule_id = v_schedule.id and status in ('DRAFT', 'SUBMITTED', 'RETURNED')
  for update;
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
      status = 'DRAFT',
      plate = v_vehicle.plate,
      driver_id = v_driver.id,
      driver_name = v_driver.name,
      row_version = row_version + 1,
      updated_at = now()
    where id = v_revision.id
    returning * into v_revision;
  end if;

  perform public.write_revision_content(v_revision.id, v_date, v_request_ids, v_legs);
  perform public.sync_schedule_inclusions(v_schedule.id);
  perform public.assert_revision_complete(v_revision.id);
  perform public.assert_people_free(v_revision.id);

  update public.schedule_revisions set
    status = 'SUBMITTED',
    submitted_at = now(),
    submitted_by_account_id = v_actor.id,
    row_version = row_version + 1,
    updated_at = now()
  where id = v_revision.id;
  update public.schedules set updated_at = now() where id = v_schedule.id;

  perform public.notify_admins(
    'SCHEDULE_SUBMITTED',
    format('%s%s %s a company trip for %s',
      case when v_priority = 'URGENT' then 'Urgent: ' else '' end,
      v_actor.name,
      case when v_existing.id is null then 'requested' else 'changed' end,
      to_char(v_date, 'FMMonth FMDD, YYYY')),
    null,
    v_schedule.id
  );
  return v_group;
end;
$$;

revoke execute on function request_company_trip(uuid, integer, jsonb) from public, anon;
grant execute on function request_company_trip(uuid, integer, jsonb) to authenticated;

-- The requester cancels their Company trip before it starts.
create function cancel_company_trip(p_group_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_group public.request_groups;
  v_schedule public.schedules;
  v_request uuid;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  select * into v_group from public.request_groups where id = p_group_id for update;
  if v_group.id is null or v_group.form_type <> 'COMPANY'
     or (v_group.owner_account_id <> v_actor.id and v_actor.role <> 'Admin') then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  v_schedule := public.company_trip_schedule_of(p_group_id);
  if v_schedule.id is not null then
    perform 1 from public.schedules where id = v_schedule.id for update;
    if public.trip_started(v_schedule.id) or exists (select 1 from public.trip_completions where schedule_id = v_schedule.id) then
      raise exception 'This trip has started, so it can''t be cancelled' using errcode = '22023';
    end if;
  end if;
  perform set_config('kova.audit_action', 'company_trip.cancel', true);
  perform set_config('kova.audit_reason', coalesce(trim(p_reason), ''), true);
  if v_schedule.id is not null then
    perform public.cancel_schedule_row(v_schedule.id, v_actor.id);
  end if;
  for v_request in select id from public.requests where group_id = p_group_id and status = 'ACTIVE' loop
    perform public.cancel_request_row(v_request, v_actor.id);
  end loop;
  if v_schedule.id is not null and v_schedule.published_revision_id is not null then
    perform public.notify(
      (select driver_id from public.schedule_revisions where id = v_schedule.published_revision_id),
      'REQUEST_CANCELLED',
      format('%s cancelled the company trip on %s', v_actor.name, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      null, v_schedule.id);
  end if;
end;
$$;

revoke execute on function cancel_company_trip(uuid, text) from public, anon;
grant execute on function cancel_company_trip(uuid, text) to authenticated;

-- Company trips no longer go through the Company request form or
-- Scheduling's Company planner.
create function refuse_old_company_trip_paths()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := coalesce(current_setting('kova.audit_action', true), '');
begin
  if tg_table_name = 'request_groups' then
    if new.form_type = 'COMPANY' and v_action in ('request.create', 'request.update') then
      raise exception 'Company trips have a new form. Reload KOVA and send it again' using errcode = '22023';
    end if;
  elsif v_action in ('schedule.save', 'schedule.submit')
        and exists (select 1 from public.schedules where id = new.schedule_id and kind = 'COMPANY') then
    raise exception 'Company trips are booked by the requester now, not on Scheduling' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function refuse_old_company_trip_paths() from public, anon, authenticated;

create trigger request_groups_refuse_old_company_path
  before insert or update on request_groups
  for each row execute function refuse_old_company_trip_paths();

create trigger schedule_revisions_refuse_old_company_path
  before insert or update on schedule_revisions
  for each row execute function refuse_old_company_trip_paths();

-- A returned Company trip goes back to its requester (who created it);
-- say so in words that fit.
create or replace function return_schedule(p_schedule_id uuid, p_expected_row_version integer, p_comment text)
returns public.schedule_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if coalesce(trim(p_comment), '') = '' then
    raise exception 'Add a comment explaining what needs to change' using errcode = '22023';
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_revision from public.schedule_revisions
  where schedule_id = p_schedule_id and status = 'SUBMITTED'
  for update;
  if v_revision is null then
    raise exception 'There is no submitted schedule to return' using errcode = '22023';
  end if;
  if v_revision.row_version is distinct from p_expected_row_version then
    raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = '40001';
  end if;

  perform set_config('kova.audit_action', 'schedule.return', true);
  perform set_config('kova.audit_reason', trim(p_comment), true);

  update public.schedule_revisions set
    status = 'RETURNED',
    decided_at = now(),
    decided_by_account_id = v_actor.id,
    decision_comment = trim(p_comment),
    row_version = row_version + 1,
    updated_at = now()
  where id = v_revision.id
  returning * into v_revision;

  perform public.notify(
    v_schedule.created_by_account_id,
    'SCHEDULE_RETURNED',
    format(case when v_schedule.kind = 'COMPANY'
                then 'Your company trip request for %s was returned: %s'
                else 'Your schedule for %s was returned: %s' end,
           to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY'), trim(p_comment)),
    null,
    p_schedule_id
  );

  return v_revision;
end;
$$;

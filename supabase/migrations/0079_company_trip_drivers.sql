-- Company trip Drivers (owner's call, 2026-10-22): the Driver picked on a
-- Company Trip records it, not the requester (0055). Anyone an Admin allows
-- can be that Driver: "Can drive company trips" on the account, off by
-- default. A Company car Driver always can; a Truck driver never.
--
-- * The trip's Driver taps Start trip, Arrived / Leaving and End trip on My
--   Trips (company_trip_for_recording), and an Admin still can. Whoever
--   started a trip under the old rule can still finish it.
-- * The request form, the Scheduling page and approval take any account
--   that can drive company trips (can_drive_company), not only Drivers.
-- lib/request-access.ts mirrors can_drive_company for the screens.

alter table accounts add column can_drive_company boolean not null default false;

-- Whether this account may be a Company trip's Driver.
create function can_drive_company(p_account public.accounts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_account.id is not null
    and p_account.status = 'Active'
    and case when p_account.role = 'Driver' then p_account.driver_type = 'Company car'
             else p_account.can_drive_company end;
$$;

revoke execute on function can_drive_company(public.accounts) from public, anon, authenticated;

create or replace function resolve_group_fields(
  p_actor public.accounts,
  p_form_type text,
  p_input jsonb,
  p_kept public.request_groups default null
)
returns public.request_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.request_groups;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_choice record;
  v_driver public.accounts;
  v_projects integer;
  v_project_id text;
begin
  v_group.form_type := p_form_type;
  -- A Daily request has none of the Company Trip fields.
  v_group.starting_point_name := '';
  v_group.department_name := '';
  v_group.driver_name := '';
  v_group.supervisor_name := '';
  v_group.head_name := '';
  v_group.site_officer := '';
  v_group.site_company := '';
  v_group.requested_date := nullif(p_input ->> 'date', '')::date;
  if v_group.requested_date is null then
    raise exception 'Select a date' using errcode = '22023';
  end if;
  if v_group.requested_date < v_today and p_actor.role <> 'Admin'
     and v_group.requested_date is distinct from p_kept.requested_date then
    raise exception 'That date has passed. Choose today or a later date' using errcode = '22023';
  end if;

  if p_form_type = 'DAILY' then
    return v_group;
  end if;

  select * into v_choice from public.resolve_choice('starting_points', p_input ->> 'startingPointId', 'Starting point',
    p_kept.starting_point_id, p_kept.starting_point_name);
  v_group.starting_point_id := v_choice.id;
  v_group.starting_point_name := v_choice.name;
  -- The Department / Site is the one Project / Site all the stops share.
  select count(distinct coalesce(stop ->> 'projectId', '')), max(stop ->> 'projectId')
  into v_projects, v_project_id
  from jsonb_array_elements(coalesce(p_input -> 'stops', '[]'::jsonb)) stop;
  if v_projects > 1 then
    raise exception 'A company trip is for one Project / Site. Pick the same one for every stop' using errcode = '22023';
  end if;
  select * into v_choice from public.resolve_choice('projects', v_project_id, 'Project / Site',
    p_kept.department_id, p_kept.department_name);
  v_group.department_id := v_choice.id;
  v_group.department_name := v_choice.name;
  select * into v_choice from public.resolve_choice('supervisors', p_input ->> 'supervisorId', 'Immediate Supervisor',
    p_kept.supervisor_id, p_kept.supervisor_name);
  v_group.supervisor_id := v_choice.id;
  v_group.supervisor_name := v_choice.name;
  select * into v_choice from public.resolve_choice('heads', p_input ->> 'headId', 'Project Manager / Construction Manager / Dept. Head',
    p_kept.head_id, p_kept.head_name);
  v_group.head_id := v_choice.id;
  v_group.head_name := v_choice.name;

  v_group.vehicle_plate := public.resolve_request_vehicle(p_input ->> 'vehiclePlate', p_kept.vehicle_plate);
  if v_group.vehicle_plate is null then
    raise exception 'Select a vehicle' using errcode = '22023';
  end if;

  if nullif(p_input ->> 'driverId', '') is null then
    raise exception 'Select a Driver' using errcode = '22023';
  end if;
  select * into v_driver from public.accounts where id = (p_input ->> 'driverId')::uuid;
  if v_driver.id is not null and v_driver.id = p_kept.driver_id then
    v_group.driver_id := p_kept.driver_id;
    v_group.driver_name := p_kept.driver_name;
  elsif not public.can_drive_company(v_driver) then
    raise exception 'Select someone who can drive company trips' using errcode = '22023';
  else
    v_group.driver_id := v_driver.id;
    v_group.driver_name := v_driver.name;
  end if;

  v_group.site_officer := left(coalesce(trim(p_input ->> 'siteOfficer'), ''), 100);
  v_group.site_company := left(coalesce(trim(p_input ->> 'siteCompany'), ''), 100);
  return v_group;
end;
$$;

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
      -- A Scheduler may change a SUBMITTED revision too (0057): it goes back
      -- to DRAFT below, for the Scheduler to resubmit. Admin editing a
      -- not-yet-submitted revision is acting as Scheduler (override);
      -- editing a SUBMITTED one is Admin's pre-existing power.
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
    if not public.can_drive_company(v_driver) then
      raise exception 'The Driver the requester picked can no longer drive company trips' using errcode = '22023';
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
      status = case
        when status = 'RETURNED' then 'DRAFT'
        when status = 'SUBMITTED' and v_actor.role = 'Scheduler' then 'DRAFT'
        else status
      end,
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

create or replace function approve_schedule(p_schedule_id uuid, p_expected_row_version integer)
returns public.schedule_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_requester_id uuid;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_completions where schedule_id = p_schedule_id) then
    raise exception 'This trip has already been submitted by the Driver and can''t be revised' using errcode = '22023';
  end if;

  select * into v_revision from public.schedule_revisions
  where schedule_id = p_schedule_id and status = 'SUBMITTED'
  for update;
  if v_revision is null then
    raise exception 'There is no submitted schedule to approve' using errcode = '22023';
  end if;
  if v_revision.row_version is distinct from p_expected_row_version then
    raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = '40001';
  end if;

  perform public.assert_revision_complete(v_revision.id);
  if exists (
    select 1 from public.revision_requests rr
    join public.request_cancellations rc on rc.request_id = rr.request_id and rc.status = 'PENDING'
    where rr.revision_id = v_revision.id
  ) then
    raise exception 'Resolve the pending cancellation requests for this schedule first' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.accounts a
    where a.id = v_revision.driver_id and a.status = 'Active'
      and (a.role = 'Driver' or public.can_drive_company(a))
  ) then
    raise exception 'The assigned Driver is no longer active' using errcode = '22023';
  end if;
  if not exists (select 1 from public.vehicles where plate = v_revision.plate and status = 'Active') then
    raise exception 'The vehicle is no longer active' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'schedule.approve', true);

  if v_schedule.published_revision_id is not null and public.trip_started(p_schedule_id) then
    return public.apply_changes_on_road(v_schedule, v_revision, v_actor);
  end if;

  -- The version being replaced gives up its reservation in the same
  -- transaction the new one takes effect, so there is never a moment with
  -- neither (or both) in force.
  if v_schedule.published_revision_id is not null then
    delete from public.schedule_reservations where revision_id = v_schedule.published_revision_id;
    update public.schedule_revisions set status = 'SUPERSEDED', updated_at = now()
    where id = v_schedule.published_revision_id;
  end if;

  update public.schedule_revisions set
    status = 'APPROVED',
    decided_at = now(),
    decided_by_account_id = v_actor.id,
    decision_comment = '',
    row_version = row_version + 1,
    updated_at = now()
  where id = v_revision.id
  returning * into v_revision;

  update public.schedules set published_revision_id = v_revision.id, updated_at = now()
  where id = p_schedule_id;

  perform public.sync_schedule_inclusions(p_schedule_id);

  for v_requester_id in
    select distinct r.owner_account_id
    from public.revision_requests rr
    join public.requests r on r.id = rr.request_id
    where rr.revision_id = v_revision.id
  loop
    perform public.notify(
      v_requester_id,
      'REQUEST_SCHEDULED',
      format('Your request for %s was scheduled', to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      null,
      p_schedule_id
    );
  end loop;

  perform public.notify(
    v_revision.driver_id,
    'TRIP_PUBLISHED',
    format('A trip on %s was published to your schedule', to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null,
    p_schedule_id
  );

  return v_revision;
end;
$$;

create or replace function company_trip_for_recording(p_schedule_id uuid, p_actor public.accounts)
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
    p_actor.role <> 'Admin' and v_revision.driver_id <> p_actor.id
    and not exists (
      select 1 from public.company_trip_runs
      where schedule_id = p_schedule_id and started_by_account_id = p_actor.id
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

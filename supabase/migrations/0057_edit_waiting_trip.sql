-- Scheduling: a Scheduler can change a trip that's waiting for Admin
-- approval. Until now save_schedule_draft refused a SUBMITTED revision for a
-- Scheduler ("This schedule is waiting for Admin approval"). Now the change
-- takes it back from the Admin: the revision goes back to DRAFT (keeping
-- submitted_at, so the Scheduling page offers "Resubmit for approval"), and
-- the Admin sees it again once it's submitted. An Admin editing a SUBMITTED
-- revision still leaves it SUBMITTED, as before. Everything else is as in
-- 0054.

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

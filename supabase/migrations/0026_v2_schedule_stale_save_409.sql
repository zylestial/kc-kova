-- v2.0: stale schedule saves fail fast with HTTP 409 instead of hanging.
--
-- The schedule RPCs from 0021 reported a stale row_version with SQLSTATE
-- 40001, which PostgREST retries forever (see 0025, which fixed the same
-- thing for update_request). They now raise PT409, which PostgREST maps
-- to HTTP 409 without retrying.
--
-- Same as 0021 otherwise.
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
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Not authorized to edit schedules' using errcode = '42501';
  end if;

  perform set_config('kova.audit_action', 'schedule.save', true);

  if p_schedule_id is null then
    if v_actor.role <> 'Scheduler' then
      raise exception 'Only a Scheduler can create schedules' using errcode = '42501';
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
      if v_actor.role = 'Admin' and v_revision.status <> 'SUBMITTED' then
        raise exception 'Admin can only edit a schedule submitted for approval' using errcode = '42501';
      end if;
      if v_revision.row_version is distinct from p_expected_row_version then
        raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = 'PT409';
      end if;
    elsif v_actor.role <> 'Scheduler' then
      raise exception 'Only a Scheduler can start a revision' using errcode = '42501';
    end if;
  end if;

  select * into v_vehicle from public.vehicles where plate = p_plate;
  if v_vehicle is null or v_vehicle.status <> 'Active' then
    raise exception 'Select an active Vehicle' using errcode = '22023';
  end if;
  select * into v_driver from public.accounts where id = v_vehicle.assigned_driver_id;
  if v_driver is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active' then
    raise exception 'This vehicle has no Driver assigned' using errcode = '22023';
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

create or replace function submit_schedule(p_schedule_id uuid, p_expected_row_version integer)
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
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Scheduler' then
    raise exception 'Only a Scheduler can submit schedules' using errcode = '42501';
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;

  select * into v_revision from public.schedule_revisions
  where schedule_id = p_schedule_id and status in ('DRAFT', 'RETURNED')
  for update;
  if v_revision is null then
    raise exception 'There is no draft to submit' using errcode = '22023';
  end if;
  if v_revision.row_version is distinct from p_expected_row_version then
    raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = 'PT409';
  end if;

  perform public.assert_revision_complete(v_revision.id);
  perform set_config('kova.audit_action', 'schedule.submit', true);

  update public.schedule_revisions set
    status = 'SUBMITTED',
    submitted_at = now(),
    submitted_by_account_id = v_actor.id,
    row_version = row_version + 1,
    updated_at = now()
  where id = v_revision.id
  returning * into v_revision;

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
    raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = 'PT409';
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
    select 1 from public.accounts
    where id = v_revision.driver_id and role = 'Driver' and status = 'Active'
  ) then
    raise exception 'The assigned Driver is no longer active' using errcode = '22023';
  end if;
  if not exists (select 1 from public.vehicles where plate = v_revision.plate and status = 'Active') then
    raise exception 'The vehicle is no longer active' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'schedule.approve', true);

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

  return v_revision;
end;
$$;

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
    raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = 'PT409';
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

  return v_revision;
end;
$$;

-- Discards an unsubmitted draft (DRAFT or RETURNED): frees its reservation
-- and unlocks any request only it was holding. If the schedule was never
-- approved, the whole schedule is discarded. Discarding a proposed
-- revision of an approved schedule leaves the approved version in force.
-- This is not cancellation of an approved schedule (Phase 7).
create or replace function discard_schedule_draft(p_schedule_id uuid, p_expected_row_version integer)
returns public.schedules
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
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Scheduler' then
    raise exception 'Only a Scheduler can discard drafts' using errcode = '42501';
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;

  select * into v_revision from public.schedule_revisions
  where schedule_id = p_schedule_id and status in ('DRAFT', 'RETURNED')
  for update;
  if v_revision is null then
    raise exception 'There is no draft to discard' using errcode = '22023';
  end if;
  if v_revision.row_version is distinct from p_expected_row_version then
    raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = 'PT409';
  end if;

  perform set_config('kova.audit_action', 'schedule.discard_draft', true);

  delete from public.schedule_reservations where revision_id = v_revision.id;
  update public.schedule_revisions set status = 'DISCARDED', updated_at = now()
  where id = v_revision.id;

  if v_schedule.published_revision_id is null then
    update public.schedules set status = 'DISCARDED', updated_at = now()
    where id = p_schedule_id;
  else
    update public.schedules set updated_at = now() where id = p_schedule_id;
  end if;

  perform public.sync_schedule_inclusions(p_schedule_id);

  select * into v_schedule from public.schedules where id = p_schedule_id;
  return v_schedule;
end;
$$;


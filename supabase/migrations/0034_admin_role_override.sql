-- v2.2: Admin "view as Scheduler / Driver" override.
--
-- Not impersonation: Admin's own account gains the ability to perform
-- Scheduler and Driver writes, attributed to Admin (the real actor), not to
-- any Scheduler/Driver account. Every widened check below is additive --
-- the existing Scheduler-only / Driver-only paths are unchanged, Admin is
-- only ever added alongside them. Admin's own pre-existing powers (approve,
-- return, cancel, correct completion, mark done, handle problem) are
-- untouched and are never flagged as an override.
--
-- Reads need no change: can_view_schedule/can_view_revision already grant
-- Admin (and Scheduler) full visibility of every schedule, and
-- trip_completions_select/problem_reports_select already grant Admin full
-- visibility of every completion and problem report.
--
-- audit_events gets a new is_admin_override column, set the same way
-- kova.audit_action/kova.audit_reason already are: a transaction-local
-- setting the RPC sets before its write, that write_audit_event() reads.
-- It defaults false, so plain Scheduler/Driver actions and Admin's own
-- normal actions are unaffected.

alter table audit_events add column is_admin_override boolean not null default false;

create or replace function write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_before = v_after then
    return new;
  end if;

  insert into public.audit_events (
    actor_account_id, actor_role, action, table_name, record_id, reason, before, after, is_admin_override
  ) values (
    auth.uid(),
    (select role from public.accounts where id = auth.uid()),
    coalesce(nullif(current_setting('kova.audit_action', true), ''), lower(tg_op)),
    tg_table_name,
    (coalesce(v_after, v_before) ->> 'id')::uuid,
    nullif(current_setting('kova.audit_reason', true), ''),
    v_before,
    v_after,
    coalesce(nullif(current_setting('kova.audit_is_override', true), ''), 'false')::boolean
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function write_audit_event() from public;
revoke execute on function write_audit_event() from anon;

-- save_schedule_draft: same as 0026, plus Admin may create a schedule,
-- start a proposed revision on an approved one, or edit a DRAFT/RETURNED
-- revision -- everything a Scheduler could already do -- flagged as an
-- override. Admin editing a SUBMITTED revision is unchanged (pre-existing
-- Admin power, not an override).
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

-- submit_schedule: same as 0026, plus Admin may submit, as Scheduler
-- override.
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
  v_is_override boolean := false;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Only a Scheduler can submit schedules' using errcode = '42501';
  end if;
  if v_actor.role = 'Admin' then
    v_is_override := true;
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
  if v_is_override then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;

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

-- discard_schedule_draft: same as 0026, plus Admin may discard, as
-- Scheduler override.
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
  v_is_override boolean := false;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Only a Scheduler can discard drafts' using errcode = '42501';
  end if;
  if v_actor.role = 'Admin' then
    v_is_override := true;
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
  if v_is_override then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;

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

-- submit_completion: same as 0029, plus Admin may complete any vehicle's
-- trip, as Driver override -- not scoped to the schedule's assigned Driver,
-- since Admin has no driver_id of their own. The completion is attributed
-- to Admin (driver_id = Admin's account id), never to the real Driver.
create or replace function submit_completion(
  p_schedule_id uuid,
  p_start_odometer integer,
  p_end_odometer integer
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
  v_trip_end timestamptz;
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

  if p_start_odometer is null or p_end_odometer is null
     or p_start_odometer < 0 or p_end_odometer < p_start_odometer then
    raise exception 'Enter whole-number odometer readings, with the end no lower than the start'
      using errcode = '22023';
  end if;

  select upper(period) into v_trip_end
  from public.schedule_reservations where revision_id = v_revision.id;
  if v_trip_end is null or v_trip_end > now() then
    raise exception 'This trip hasn''t ended yet' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'completion.submit', true);
  if v_is_override then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;
  insert into public.trip_completions (schedule_id, revision_id, driver_id, start_odometer, end_odometer)
  values (p_schedule_id, v_revision.id, v_actor.id, p_start_odometer, p_end_odometer)
  returning * into v_completion;

  return v_completion;
end;
$$;

-- report_problem: same as 0029, plus Admin may report a problem on any
-- vehicle's trip, as Driver override, attributed to Admin.
create or replace function report_problem(p_schedule_id uuid, p_note text)
returns public.problem_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_report public.problem_reports;
  v_is_override boolean := false;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Driver', 'Admin') then
    raise exception 'Driver access required' using errcode = '42501';
  end if;
  if v_actor.role = 'Admin' then
    v_is_override := true;
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Describe the problem' using errcode = '22023';
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
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'problem.report', true);
  if v_is_override then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;
  insert into public.problem_reports (schedule_id, revision_id, driver_id, note)
  values (p_schedule_id, v_revision.id, v_actor.id, trim(p_note))
  returning * into v_report;

  return v_report;
end;
$$;

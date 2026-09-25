-- v2.0 schedule RPCs: save_schedule_draft, submit_schedule,
-- approve_schedule, return_schedule, discard_schedule_draft.
--
-- Who may do what (enforced here, not only in the UI):
--   Scheduler  creates schedules; edits DRAFT/RETURNED revisions; starts a
--              proposed revision of an approved schedule; submits; discards
--              an unsubmitted draft.
--   Admin      edits a SUBMITTED revision while reviewing it; approves or
--              returns it with a comment. Admin can never create a schedule.
--
-- Every RPC locks the schedule row first (FOR UPDATE), then the open
-- revision, then requests in id order, so concurrent calls on the same
-- schedule serialize and can't deadlock each other. Every edit carries the
-- caller's p_expected_row_version of the open revision; a stale copy is
-- rejected (SQLSTATE 40001) instead of overwriting someone else's change.
--
-- Legs are passed as a JSON array in travel order:
--   [{"destinationId": "d1", "plannedTimeOut": "08:15", "plannedTimeIn": "09:00",
--     "contactName": "", "contactNumber": "", "stops": ["<request_destination id>", ...]},
--    ...,
--    {"isFinal": true, "plannedTimeOut": "15:00", "plannedTimeIn": "16:00"}]
-- Origins are derived server-side: leg 1 starts at ANONANG, and each later
-- leg starts where the previous one ended. A final leg returns to ANONANG,
-- must be last, and there can only be one.

-- Replaces a revision's request list, legs, stops and reservation. Internal.
create function write_revision_content(
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
  v_request_destination public.request_destinations;
begin
  if jsonb_typeof(v_legs) <> 'array' then
    raise exception 'Legs must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(v_legs) > 30 then
    raise exception 'A schedule can have at most 30 legs' using errcode = '22023';
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

    if coalesce(v_leg ->> 'plannedTimeOut', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(v_leg ->> 'plannedTimeIn', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Leg %: enter planned times as HH:MM', v_no using errcode = '22023';
    end if;
    v_out := (v_leg ->> 'plannedTimeOut')::time(0);
    v_in := (v_leg ->> 'plannedTimeIn')::time(0);
    if v_in <= v_out then
      raise exception 'Leg %: planned Time In must be after Time Out', v_no using errcode = '22023';
    end if;
    if v_prev_in is not null and v_out < v_prev_in then
      raise exception 'Leg %: planned Time Out can''t be before the previous leg''s Time In', v_no using errcode = '22023';
    end if;

    if v_is_final then
      if jsonb_array_length(v_stops) > 0 then
        raise exception 'The final leg back to ANONANG has no request stops' using errcode = '22023';
      end if;
      v_destination_id := null;
      v_destination_name := 'ANONANG';
      v_final_seen := true;
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
      v_destination_id := v_destination.id;
      v_destination_name := v_destination.name;
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
      if v_request_destination.destination_id <> v_destination_id then
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
  if v_first_out is not null then
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

-- Recomputes which requests the schedule holds: those in its published
-- revision or its open revision (while the schedule is ACTIVE and the
-- request isn't cancelled). Releases the rest, unlocking them. Internal.
create function sync_schedule_inclusions(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.schedules;
  v_needed uuid[];
begin
  select * into v_schedule from public.schedules where id = p_schedule_id;

  if v_schedule.status = 'ACTIVE' then
    select coalesce(array_agg(distinct rr.request_id), '{}') into v_needed
    from public.revision_requests rr
    join public.schedule_revisions sr on sr.id = rr.revision_id
    join public.requests r on r.id = rr.request_id
    where sr.schedule_id = p_schedule_id
      and r.status = 'ACTIVE'
      and (sr.id = v_schedule.published_revision_id or sr.status in ('DRAFT', 'SUBMITTED', 'RETURNED'));
  else
    v_needed := '{}';
  end if;

  update public.schedule_requests
  set active = false, released_at = now(), released_by_account_id = auth.uid()
  where schedule_id = p_schedule_id and active and not (request_id = any(v_needed));

  insert into public.schedule_requests (schedule_id, request_id, included_by_account_id)
  select p_schedule_id, needed.id, auth.uid()
  from unnest(v_needed) as needed (id)
  where not exists (
    select 1 from public.schedule_requests
    where schedule_id = p_schedule_id and request_id = needed.id and active
  );
exception
  when unique_violation then
    raise exception 'One of these requests is already in another schedule' using errcode = '23505';
end;
$$;

-- Checks a revision is ready for approval. Internal.
create function assert_revision_complete(p_revision_id uuid)
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
  if not exists (
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

revoke execute on function write_revision_content(uuid, date, uuid[], jsonb) from public, anon, authenticated;
revoke execute on function sync_schedule_inclusions(uuid) from public, anon, authenticated;
revoke execute on function assert_revision_complete(uuid) from public, anon, authenticated;

create function save_schedule_draft(
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
        raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = '40001';
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

create function submit_schedule(p_schedule_id uuid, p_expected_row_version integer)
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
    raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = '40001';
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

create function approve_schedule(p_schedule_id uuid, p_expected_row_version integer)
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

create function return_schedule(p_schedule_id uuid, p_expected_row_version integer, p_comment text)
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

  return v_revision;
end;
$$;

-- Discards an unsubmitted draft (DRAFT or RETURNED): frees its reservation
-- and unlocks any request only it was holding. If the schedule was never
-- approved, the whole schedule is discarded. Discarding a proposed
-- revision of an approved schedule leaves the approved version in force.
-- This is not cancellation of an approved schedule (Phase 7).
create function discard_schedule_draft(p_schedule_id uuid, p_expected_row_version integer)
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
    raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = '40001';
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

revoke execute on function save_schedule_draft(uuid, integer, date, text, uuid[], jsonb) from public, anon;
grant execute on function save_schedule_draft(uuid, integer, date, text, uuid[], jsonb) to authenticated;
revoke execute on function submit_schedule(uuid, integer) from public, anon;
grant execute on function submit_schedule(uuid, integer) to authenticated;
revoke execute on function approve_schedule(uuid, integer) from public, anon;
grant execute on function approve_schedule(uuid, integer) to authenticated;
revoke execute on function return_schedule(uuid, integer, text) from public, anon;
grant execute on function return_schedule(uuid, integer, text) to authenticated;
revoke execute on function discard_schedule_draft(uuid, integer) from public, anon;
grant execute on function discard_schedule_draft(uuid, integer) to authenticated;

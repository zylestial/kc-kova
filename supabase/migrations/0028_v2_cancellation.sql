-- v2.0 cancellation RPCs: cancel_request, request_cancellation,
-- decline_cancellation, confirm_cancellation, cancel_schedule.
--
-- Nothing is ever deleted: cancelled requests and schedules keep their rows,
-- and approved revisions stay as history.
--
--   cancel_request          Owner cancels a request no schedule holds. Also
--                           closes any pending cancellation left behind by a
--                           release (e.g. the draft it was in was discarded).
--   request_cancellation    Owner asks to cancel a request a schedule holds.
--                           The schedule stays in force while it is PENDING.
--   decline_cancellation    Admin says no (note required). Nothing changes.
--   confirm_cancellation    Admin says yes. Cancels only that request. If the
--                           schedule still serves other requests it needs a
--                           new revision without this one (the Scheduler
--                           proposes it, the Admin approves it); if not, the
--                           whole schedule is cancelled.
--   cancel_schedule         Admin cancels a schedule: frees its reservations,
--                           returns requests still needed to NOT_YET_SCHEDULED.
--
-- Nothing here works once the Driver has submitted a completion: a
-- submitted or Done trip is corrected through finished-record rules.
-- Every RPC is safe to repeat. Lock order matches the schedule RPCs:
-- schedule first, then requests.

-- Cancels one request row and closes its pending cancellation, if any.
-- Internal: callers have already locked the request.
create function cancel_request_row(p_request_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.requests set
    status = 'CANCELLED',
    cancelled_at = now(),
    cancelled_by_account_id = p_actor,
    row_version = row_version + 1,
    updated_at = now()
  where id = p_request_id and status = 'ACTIVE';

  update public.request_cancellations set
    status = 'CONFIRMED',
    decided_by_account_id = p_actor,
    decided_at = now()
  where request_id = p_request_id and status = 'PENDING';
end;
$$;

-- Cancels a schedule. Internal: callers have already locked the schedule.
-- Requests with a pending cancellation are cancelled (the Requester asked);
-- every other request is released back to NOT_YET_SCHEDULED.
create function cancel_schedule_row(p_schedule_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  for v_request_id in
    select sr.request_id
    from public.schedule_requests sr
    where sr.schedule_id = p_schedule_id and sr.active
      and exists (
        select 1 from public.request_cancellations rc
        where rc.request_id = sr.request_id and rc.status = 'PENDING'
      )
    order by sr.request_id
  loop
    perform 1 from public.requests where id = v_request_id for update;
    perform public.cancel_request_row(v_request_id, p_actor);
  end loop;

  update public.schedule_revisions set status = 'DISCARDED', updated_at = now()
  where schedule_id = p_schedule_id and status in ('DRAFT', 'SUBMITTED', 'RETURNED');
  delete from public.schedule_reservations where schedule_id = p_schedule_id;

  update public.schedules set
    status = 'CANCELLED',
    cancelled_at = now(),
    cancelled_by_account_id = p_actor,
    updated_at = now()
  where id = p_schedule_id;

  perform public.sync_schedule_inclusions(p_schedule_id);
end;
$$;

revoke execute on function cancel_request_row(uuid, uuid) from public, anon, authenticated;
revoke execute on function cancel_schedule_row(uuid, uuid) from public, anon, authenticated;

create function cancel_request(p_request_id uuid)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_request public.requests;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Requester', 'Admin') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_request from public.requests where id = p_request_id for update;
  if v_request is null or v_request.owner_account_id <> v_actor.id then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_request.status = 'CANCELLED' then
    return v_request;
  end if;
  if exists (select 1 from public.schedule_requests where request_id = p_request_id and active) then
    raise exception 'This request is in a schedule. Ask for its cancellation instead' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_completions tc
             join public.schedule_requests sr on sr.schedule_id = tc.schedule_id
             where sr.request_id = p_request_id) then
    raise exception 'This trip has already been completed and can''t be cancelled' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'request.cancel', true);
  perform public.cancel_request_row(p_request_id, v_actor.id);

  select * into v_request from public.requests where id = p_request_id;
  return v_request;
end;
$$;

create function request_cancellation(p_request_id uuid, p_reason text)
returns public.request_cancellations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_request public.requests;
  v_schedule_id uuid;
  v_cancellation public.request_cancellations;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Requester', 'Admin') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_request from public.requests where id = p_request_id for update;
  if v_request is null or v_request.owner_account_id <> v_actor.id then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_request.status = 'CANCELLED' then
    raise exception 'This request is already cancelled' using errcode = '22023';
  end if;

  select * into v_cancellation from public.request_cancellations
  where request_id = p_request_id and status = 'PENDING';
  if v_cancellation.id is not null then
    return v_cancellation;
  end if;

  select schedule_id into v_schedule_id from public.schedule_requests
  where request_id = p_request_id and active;
  if v_schedule_id is null then
    raise exception 'This request isn''t in a schedule. Cancel it directly' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_completions where schedule_id = v_schedule_id) then
    raise exception 'This trip has already been completed and can''t be cancelled' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'request.cancellation_requested', true);
  insert into public.request_cancellations (request_id, requested_by_account_id, reason)
  values (p_request_id, v_actor.id, coalesce(trim(p_reason), ''))
  returning * into v_cancellation;

  return v_cancellation;
end;
$$;

create function decline_cancellation(p_cancellation_id uuid, p_note text)
returns public.request_cancellations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_cancellation public.request_cancellations;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Add a note explaining why the request stays' using errcode = '22023';
  end if;

  select * into v_cancellation from public.request_cancellations where id = p_cancellation_id for update;
  if v_cancellation is null then
    raise exception 'Cancellation request not found' using errcode = 'P0002';
  end if;
  if v_cancellation.status = 'DECLINED' then
    return v_cancellation;
  end if;
  if v_cancellation.status <> 'PENDING' then
    raise exception 'This cancellation was already confirmed' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'request.cancellation_declined', true);
  perform set_config('kova.audit_reason', trim(p_note), true);
  update public.request_cancellations set
    status = 'DECLINED',
    decided_by_account_id = v_actor.id,
    decided_at = now(),
    decision_note = trim(p_note)
  where id = p_cancellation_id
  returning * into v_cancellation;

  return v_cancellation;
end;
$$;

create function confirm_cancellation(p_cancellation_id uuid)
returns public.request_cancellations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_cancellation public.request_cancellations;
  v_schedule_id uuid;
  v_schedule public.schedules;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select * into v_cancellation from public.request_cancellations where id = p_cancellation_id;
  if v_cancellation is null then
    raise exception 'Cancellation request not found' using errcode = 'P0002';
  end if;

  -- Schedule first, then the request, like every schedule RPC.
  select schedule_id into v_schedule_id from public.schedule_requests
  where request_id = v_cancellation.request_id and active;
  if v_schedule_id is not null then
    select * into v_schedule from public.schedules where id = v_schedule_id for update;
  end if;
  perform 1 from public.requests where id = v_cancellation.request_id for update;

  select * into v_cancellation from public.request_cancellations where id = p_cancellation_id for update;
  if v_cancellation.status = 'CONFIRMED' then
    return v_cancellation;
  end if;
  if v_cancellation.status <> 'PENDING' then
    raise exception 'This cancellation was already declined' using errcode = '22023';
  end if;
  if (select schedule_id from public.schedule_requests
      where request_id = v_cancellation.request_id and active) is distinct from v_schedule_id then
    raise exception 'This request was moved while you were reviewing. Reload and try again' using errcode = '40001';
  end if;
  if v_schedule_id is not null
     and exists (select 1 from public.trip_completions where schedule_id = v_schedule_id) then
    raise exception 'This trip has already been completed. Decline the cancellation instead' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'request.cancellation_confirmed', true);
  perform public.cancel_request_row(v_cancellation.request_id, v_actor.id);

  if v_schedule_id is not null then
    -- Cancel the schedule itself when no live request is left in it.
    if not exists (
      select 1
      from public.revision_requests rr
      join public.schedule_revisions sr on sr.id = rr.revision_id
      join public.requests r on r.id = rr.request_id
      where sr.schedule_id = v_schedule_id and r.status = 'ACTIVE'
        and (sr.id = v_schedule.published_revision_id or sr.status in ('DRAFT', 'SUBMITTED', 'RETURNED'))
    ) then
      perform set_config('kova.audit_action', 'schedule.cancel', true);
      perform public.cancel_schedule_row(v_schedule_id, v_actor.id);
    else
      perform public.sync_schedule_inclusions(v_schedule_id);
    end if;
  end if;

  select * into v_cancellation from public.request_cancellations where id = p_cancellation_id;
  return v_cancellation;
end;
$$;

create function cancel_schedule(p_schedule_id uuid, p_reason text)
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
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Add a reason for cancelling this schedule' using errcode = '22023';
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  if v_schedule.status = 'CANCELLED' then
    return v_schedule;
  end if;
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_completions where schedule_id = p_schedule_id) then
    raise exception 'This trip has already been completed and can''t be cancelled' using errcode = '22023';
  end if;

  perform 1 from public.requests
  where id in (select request_id from public.schedule_requests where schedule_id = p_schedule_id and active)
  order by id for update;

  perform set_config('kova.audit_action', 'schedule.cancel', true);
  perform set_config('kova.audit_reason', trim(p_reason), true);
  perform public.cancel_schedule_row(p_schedule_id, v_actor.id);

  select * into v_schedule from public.schedules where id = p_schedule_id;
  return v_schedule;
end;
$$;

revoke execute on function cancel_request(uuid) from public, anon;
grant execute on function cancel_request(uuid) to authenticated;
revoke execute on function request_cancellation(uuid, text) from public, anon;
grant execute on function request_cancellation(uuid, text) to authenticated;
revoke execute on function decline_cancellation(uuid, text) from public, anon;
grant execute on function decline_cancellation(uuid, text) to authenticated;
revoke execute on function confirm_cancellation(uuid) from public, anon;
grant execute on function confirm_cancellation(uuid) to authenticated;
revoke execute on function cancel_schedule(uuid, text) from public, anon;
grant execute on function cancel_schedule(uuid, text) to authenticated;

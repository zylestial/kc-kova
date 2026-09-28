-- v2.2: in-app notifications.
--
-- One row per (recipient, event). Written only from inside the existing
-- RPCs that cause the event, in the same transaction as the change itself,
-- so a notification can never be lost or duplicated relative to the event
-- it describes. Nothing above the RPC layer is ever granted insert/update
-- on this table directly -- reading your own notifications and marking
-- them read go through RLS and a dedicated RPC respectively, same as every
-- other write path in this app.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id),
  type text not null check (type in (
    'REQUEST_SCHEDULED',
    'REQUEST_RETURNED',
    'REQUEST_CANCELLED',
    'CANCELLATION_DECLINED',
    'CANCELLATION_REQUESTED',
    'PROBLEM_REPORTED',
    'SCHEDULE_SUBMITTED',
    'SCHEDULE_RETURNED',
    'TRIP_PUBLISHED'
  )),
  message text not null,
  related_request_id uuid references requests (id),
  related_schedule_id uuid references schedules (id),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_account_id_idx on notifications (account_id, created_at desc);
create index notifications_related_request_id_idx on notifications (related_request_id);
create index notifications_related_schedule_id_idx on notifications (related_schedule_id);

alter table notifications enable row level security;

grant select on notifications to authenticated;

create policy notifications_select on notifications for select
  using (account_id = (select auth.uid()));

-- Internal: inserts one notification. Only ever called from inside another
-- security definer RPC, never granted to anon/authenticated directly.
create function notify(
  p_account_id uuid,
  p_type text,
  p_message text,
  p_request_id uuid default null,
  p_schedule_id uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (account_id, type, message, related_request_id, related_schedule_id)
  values (p_account_id, p_type, p_message, p_request_id, p_schedule_id);
end;
$$;

revoke execute on function notify(uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- Internal: notifies every active Admin. Used for events that need Admin
-- attention (a submitted schedule, a cancellation request, a reported
-- problem) rather than one specific recipient.
create function notify_admins(
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
  v_admin_id uuid;
begin
  for v_admin_id in select id from public.accounts where role = 'Admin' and status = 'Active' loop
    perform public.notify(v_admin_id, p_type, p_message, p_request_id, p_schedule_id);
  end loop;
end;
$$;

revoke execute on function notify_admins(text, text, uuid, uuid) from public, anon, authenticated;

create function mark_notification_read(p_id uuid)
returns public.notifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.notifications;
begin
  select * into v_notification from public.notifications where id = p_id;
  if v_notification is null or v_notification.account_id <> auth.uid() then
    raise exception 'Notification not found' using errcode = 'P0002';
  end if;

  update public.notifications set read_at = coalesce(read_at, now())
  where id = p_id
  returning * into v_notification;

  return v_notification;
end;
$$;

revoke execute on function mark_notification_read(uuid) from public, anon;
grant execute on function mark_notification_read(uuid) to authenticated;

create function mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications set read_at = now()
  where account_id = auth.uid() and read_at is null;
end;
$$;

revoke execute on function mark_all_notifications_read() from public, anon;
grant execute on function mark_all_notifications_read() to authenticated;

-- submit_schedule: same as 0034, plus notifies every Admin.
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

  perform public.notify_admins(
    'SCHEDULE_SUBMITTED',
    format('A schedule for %s was submitted for approval', to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null,
    p_schedule_id
  );

  return v_revision;
end;
$$;

-- approve_schedule: same as 0021, plus notifies each newly-attached
-- Requester and the assigned Driver.
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

-- return_schedule: same as 0021, plus notifies the Scheduler who owns the
-- schedule.
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
    format('Your schedule for %s was returned: %s', to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY'), trim(p_comment)),
    null,
    p_schedule_id
  );

  return v_revision;
end;
$$;

-- request_cancellation: same as 0028, plus notifies every Admin.
create or replace function request_cancellation(p_request_id uuid, p_reason text)
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

  perform public.notify_admins(
    'CANCELLATION_REQUESTED',
    format('%s asked to cancel a scheduled request', v_request.owner_name),
    p_request_id,
    v_schedule_id
  );

  return v_cancellation;
end;
$$;

-- decline_cancellation: same as 0028, plus notifies the Requester.
create or replace function decline_cancellation(p_cancellation_id uuid, p_note text)
returns public.request_cancellations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_cancellation public.request_cancellations;
  v_request public.requests;
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

  select * into v_request from public.requests where id = v_cancellation.request_id;
  perform public.notify(
    v_request.owner_account_id,
    'CANCELLATION_DECLINED',
    format('Your cancellation request was declined: %s', trim(p_note)),
    v_request.id,
    null
  );

  return v_cancellation;
end;
$$;

-- confirm_cancellation: same as 0028, plus notifies the cancelled
-- Requester and, if the whole schedule is cancelled with it, every other
-- Requester released back to the pool.
create or replace function confirm_cancellation(p_cancellation_id uuid)
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
  v_request public.requests;
  v_other_request_ids uuid[];
  v_other_request public.requests;
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

  select * into v_request from public.requests where id = v_cancellation.request_id;

  -- Other still-active requests this schedule serves, captured before the
  -- cascade below may cancel the whole schedule and release/cancel them.
  if v_schedule_id is not null then
    select coalesce(array_agg(sr.request_id), '{}') into v_other_request_ids
    from public.schedule_requests sr
    where sr.schedule_id = v_schedule_id and sr.active and sr.request_id <> v_cancellation.request_id;
  end if;

  perform set_config('kova.audit_action', 'request.cancellation_confirmed', true);
  perform public.cancel_request_row(v_cancellation.request_id, v_actor.id);

  perform public.notify(
    v_request.owner_account_id,
    'REQUEST_CANCELLED',
    'Your request was cancelled',
    v_request.id,
    v_schedule_id
  );

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

      -- Each of these was released to NOT_YET_SCHEDULED, unless it had its
      -- own pending cancellation confirmed by cancel_schedule_row's own
      -- cascade, in which case it's now CANCELLED instead.
      for v_other_request in
        select * from public.requests where id = any(v_other_request_ids)
      loop
        if v_other_request.status = 'CANCELLED' then
          perform public.notify(
            v_other_request.owner_account_id,
            'REQUEST_CANCELLED',
            'Your request was cancelled',
            v_other_request.id,
            v_schedule_id
          );
        else
          perform public.notify(
            v_other_request.owner_account_id,
            'REQUEST_RETURNED',
            format('Your request for %s needs a new schedule', to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
            v_other_request.id,
            v_schedule_id
          );
        end if;
      end loop;
    else
      perform public.sync_schedule_inclusions(v_schedule_id);
    end if;
  end if;

  select * into v_cancellation from public.request_cancellations where id = p_cancellation_id;
  return v_cancellation;
end;
$$;

-- cancel_schedule: same as 0028, plus notifies each Requester released
-- back to NOT_YET_SCHEDULED.
create or replace function cancel_schedule(p_schedule_id uuid, p_reason text)
returns public.schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_released_ids uuid[];
  v_released_request public.requests;
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

  -- Requests that will be released back to NOT_YET_SCHEDULED (no pending
  -- cancellation of their own), captured before the cascade below.
  select coalesce(array_agg(sr.request_id), '{}') into v_released_ids
  from public.schedule_requests sr
  where sr.schedule_id = p_schedule_id and sr.active
    and not exists (
      select 1 from public.request_cancellations rc
      where rc.request_id = sr.request_id and rc.status = 'PENDING'
    );

  perform set_config('kova.audit_action', 'schedule.cancel', true);
  perform set_config('kova.audit_reason', trim(p_reason), true);
  perform public.cancel_schedule_row(p_schedule_id, v_actor.id);

  for v_released_request in
    select * from public.requests where id = any(v_released_ids)
  loop
    perform public.notify(
      v_released_request.owner_account_id,
      'REQUEST_RETURNED',
      format('Your request for %s needs a new schedule', to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      v_released_request.id,
      p_schedule_id
    );
  end loop;

  select * into v_schedule from public.schedules where id = p_schedule_id;
  return v_schedule;
end;
$$;

-- report_problem: same as 0034, plus notifies every Admin.
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

  perform public.notify_admins(
    'PROBLEM_REPORTED',
    format('A problem was reported on the %s trip', to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null,
    p_schedule_id
  );

  return v_report;
end;
$$;

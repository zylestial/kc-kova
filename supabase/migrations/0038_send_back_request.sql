-- v2.4: a Scheduler can send an unplaced request back to its requester.
--
-- Not every request in a day's pool fits on that day's vehicles. Rather
-- than leaving it "Not yet scheduled" on a date that will pass, the
-- Scheduler (or Admin, as Scheduler) sends it back with an optional reason.
-- The requester is notified and moves it to another day (or cancels it).
--
-- Sent back is stored on the request itself, not derived like the rest of
-- request_progress (0022): it is a decision, not a consequence of schedule
-- rows. It only ever applies to a request with no active inclusion, and is
-- cleared automatically once the requester changes the date.

alter table requests
  add column sent_back_at timestamptz,
  add column sent_back_by_account_id uuid references accounts (id),
  add column sent_back_reason text not null default '',
  add constraint requests_sent_back_consistent
    check ((sent_back_at is null) = (sent_back_by_account_id is null));

create index requests_sent_back_by_account_id_idx on requests (sent_back_by_account_id);

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'REQUEST_SCHEDULED',
  'REQUEST_RETURNED',
  'REQUEST_SENT_BACK',
  'REQUEST_CANCELLED',
  'CANCELLATION_DECLINED',
  'CANCELLATION_REQUESTED',
  'PROBLEM_REPORTED',
  'SCHEDULE_SUBMITTED',
  'SCHEDULE_RETURNED',
  'TRIP_PUBLISHED'
));

-- A new date is a fresh request for the pool, so the send-back no longer
-- applies. A trigger rather than another copy of update_request (0025),
-- since every path that moves the date should do this.
create function clear_sent_back_on_new_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sent_back_at is not null and new.requested_date is distinct from old.requested_date then
    new.sent_back_at := null;
    new.sent_back_by_account_id := null;
    new.sent_back_reason := '';
  end if;
  return new;
end;
$$;

create trigger requests_clear_sent_back
  before update of requested_date on requests
  for each row execute function clear_sent_back_on_new_date();

-- A sent-back request is out of the pool until its date changes, so no
-- schedule may take it, however the inclusion is written.
create function block_sent_back_inclusion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active and exists (
    select 1 from public.requests where id = new.request_id and sent_back_at is not null
  ) then
    raise exception 'A request in this schedule was sent back to its requester; remove it first' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function block_sent_back_inclusion() from public, anon, authenticated;

create trigger schedule_requests_block_sent_back
  before insert or update of active on schedule_requests
  for each row execute function block_sent_back_inclusion();

-- Same as 0022, plus SENT_BACK for a request with no active inclusion that
-- a Scheduler sent back.
create or replace function request_progress_of(p_request_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select case
    when not public.can_view_request_details(r.id) then null
    when r.status = 'CANCELLED' then 'CANCELLED'
    when inc.id is null and r.sent_back_at is not null then 'SENT_BACK'
    when inc.id is null then 'NOT_YET_SCHEDULED'
    when tc.status = 'DONE' then 'DONE'
    when tc.id is not null then 'COMPLETED'
    when exists (
      select 1 from public.revision_requests rr
      where rr.revision_id = s.published_revision_id and rr.request_id = r.id
    ) then 'APPROVED'
    when exists (
      select 1 from public.schedule_revisions sr
      join public.revision_requests rr on rr.revision_id = sr.id
      where sr.schedule_id = s.id and sr.status = 'SUBMITTED' and rr.request_id = r.id
    ) then 'PENDING_APPROVAL'
    else 'SCHEDULING'
  end
  from public.requests r
  left join public.schedule_requests inc on inc.request_id = r.id and inc.active
  left join public.schedules s on s.id = inc.schedule_id
  left join public.trip_completions tc on tc.schedule_id = s.id
  where r.id = p_request_id;
$$;

-- Sends one or more unplaced requests back to their requesters, all or
-- nothing. Scheduler, or Admin acting as Scheduler (0034's override).
create function send_back_requests(p_request_ids uuid[], p_reason text)
returns setof public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_reason text := coalesce(trim(p_reason), '');
  v_request public.requests;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Only a Scheduler can send requests back' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_request_ids), 0) = 0 then
    raise exception 'Choose at least one request to send back' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters' using errcode = '22023';
  end if;

  perform 1 from public.requests where id = any(p_request_ids) order by id for update;
  if (select count(*) from public.requests where id = any(p_request_ids))
     <> (select count(distinct id) from unnest(p_request_ids) as given (id)) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;

  for v_request in
    select * from public.requests where id = any(p_request_ids) order by id
  loop
    if v_request.status <> 'ACTIVE' then
      raise exception 'A request was cancelled by its requester. Reload and try again' using errcode = '22023';
    end if;
    if exists (select 1 from public.schedule_requests where request_id = v_request.id and active) then
      raise exception 'A request is already in a schedule; remove it from that schedule first' using errcode = '22023';
    end if;
  end loop;

  perform set_config('kova.audit_action', 'request.send_back', true);
  perform set_config('kova.audit_reason', v_reason, true);
  perform set_config('kova.audit_is_override', (v_actor.role = 'Admin')::text, true);

  for v_request in
    update public.requests set
      sent_back_at = now(),
      sent_back_by_account_id = v_actor.id,
      sent_back_reason = v_reason,
      row_version = row_version + 1,
      updated_at = now()
    where id = any(p_request_ids) and sent_back_at is null
    returning *
  loop
    if v_request.owner_account_id <> v_actor.id then
      perform public.notify(
        v_request.owner_account_id,
        'REQUEST_SENT_BACK',
        format('Your request for %s couldn''t be scheduled. Pick another day', to_char(v_request.requested_date, 'FMMonth FMDD, YYYY')),
        v_request.id
      );
    end if;
  end loop;

  return query select * from public.requests where id = any(p_request_ids) order by id;
end;
$$;

revoke execute on function send_back_requests(uuid[], text) from public, anon;
grant execute on function send_back_requests(uuid[], text) to authenticated;

-- v2.4: a Scheduler can split stops off a request into a new request.
--
-- A request is one trip on one vehicle: every active destination of an
-- included request must be on that schedule's route (assert_revision_complete).
-- When a vehicle can only fit some of a request's stops, the Planner splits
-- the rest off into a new request -- same requester, date, type and project
-- -- which then goes to another vehicle or is sent back (0038), like any other
-- unplaced request.
--
-- The moved destinations are copied, not re-pointed: the originals are marked
-- inactive (as an edit does, 0014), since leg stops on past revisions may
-- still reference them.

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'REQUEST_SCHEDULED',
  'REQUEST_RETURNED',
  'REQUEST_SENT_BACK',
  'REQUEST_SPLIT',
  'REQUEST_CANCELLED',
  'CANCELLATION_DECLINED',
  'CANCELLATION_REQUESTED',
  'PROBLEM_REPORTED',
  'SCHEDULE_SUBMITTED',
  'SCHEDULE_RETURNED',
  'TRIP_PUBLISHED'
));

-- Moves the given destinations of one request into a new request and
-- returns it. Scheduler, or Admin acting as Scheduler (0034's override).
create function split_request(p_request_id uuid, p_destination_ids uuid[])
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_request public.requests;
  v_new public.requests;
  v_moving int;
  v_names text;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Only a Scheduler can split requests' using errcode = '42501';
  end if;

  select * into v_request from public.requests where id = p_request_id for update;
  if v_request is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'ACTIVE' then
    raise exception 'This request was cancelled. Reload and try again' using errcode = '22023';
  end if;
  if exists (select 1 from public.request_cancellations where request_id = p_request_id and status = 'PENDING') then
    raise exception 'This request has a pending cancellation and can''t be split' using errcode = '22023';
  end if;

  select count(*) into v_moving
  from public.request_destinations
  where request_id = p_request_id and active and id = any(p_destination_ids);
  if v_moving = 0 or v_moving <> (select count(distinct id) from unnest(p_destination_ids) as given (id)) then
    raise exception 'Those stops aren''t on this request any more. Reload and try again' using errcode = '22023';
  end if;
  if v_moving = (select count(*) from public.request_destinations where request_id = p_request_id and active) then
    raise exception 'Keep at least one stop on the original request' using errcode = '22023';
  end if;
  -- A stop already on a live route stays where it is.
  if exists (
    select 1
    from public.leg_stops ls
    join public.schedule_revisions sr on sr.id = ls.revision_id
    join public.schedules s on s.id = sr.schedule_id
    where ls.request_destination_id = any(p_destination_ids)
      and s.status = 'ACTIVE'
      and (sr.status in ('DRAFT', 'SUBMITTED', 'RETURNED') or sr.id = s.published_revision_id)
  ) then
    raise exception 'A stop being split off is already on a route. Reload and try again' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'request.split', true);
  perform set_config('kova.audit_is_override', (v_actor.role = 'Admin')::text, true);

  insert into public.requests (
    owner_account_id, owner_name, requested_date, request_type,
    project_id, project_name, project_is_other
  ) values (
    v_request.owner_account_id, v_request.owner_name, v_request.requested_date, v_request.request_type,
    v_request.project_id, v_request.project_name, v_request.project_is_other
  ) returning * into v_new;

  insert into public.request_destinations (
    request_id, position, destination_id, destination_name, destination_is_other,
    purpose_id, purpose_name, purpose_is_other
  )
  select v_new.id, row_number() over (order by position), destination_id, destination_name, destination_is_other,
         purpose_id, purpose_name, purpose_is_other
  from public.request_destinations
  where request_id = p_request_id and active and id = any(p_destination_ids);

  select string_agg(destination_name, ', ' order by position) into v_names
  from public.request_destinations
  where request_id = p_request_id and active and id = any(p_destination_ids);

  update public.request_destinations set active = false
  where request_id = p_request_id and active and id = any(p_destination_ids);
  update public.requests set row_version = row_version + 1, updated_at = now()
  where id = p_request_id;

  if v_request.owner_account_id <> v_actor.id then
    perform public.notify(
      v_request.owner_account_id,
      'REQUEST_SPLIT',
      format('Your request for %s was split: %s will be planned separately', to_char(v_request.requested_date, 'FMMonth FMDD, YYYY'), v_names),
      v_new.id
    );
  end if;

  return v_new;
end;
$$;

revoke execute on function split_request(uuid, uuid[]) from public, anon;
grant execute on function split_request(uuid, uuid[]) to authenticated;

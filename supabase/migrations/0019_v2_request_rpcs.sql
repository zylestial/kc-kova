-- v2.0 request RPCs: create_request, update_request.
--
-- Date rules (Asia/Manila calendar days, checked server-side):
--   Regular: at least 7 days ahead.  Urgent: today or tomorrow only.
--   2-6 days ahead is not allowed for either type.
--   Admin may also request a past date (any type), for trips that already
--   happened; the request still records the real entry time.
--
-- Destinations are passed as a JSON array in travel order:
--   [{"destinationId": "...", "purposeId": "..."}, ...]
-- Each must be an Active option; names are snapshotted on the row.
--
-- Editing is allowed only to the owner, only while the request is ACTIVE
-- and not included in any schedule, and only if the caller's copy is
-- current (p_expected_row_version). The request row is locked FOR UPDATE,
-- the same lock schedule inclusion takes, so an edit and an inclusion can't
-- interleave.

create function check_request_date(p_role text, p_date date, p_type text)
returns void
language plpgsql
set search_path = ''
stable
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if p_type not in ('REGULAR', 'URGENT') then
    raise exception 'Invalid request type' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'Select a date' using errcode = '22023';
  end if;
  if p_role = 'Admin' and p_date < v_today then
    return;
  end if;
  if p_type = 'REGULAR' and p_date < v_today + 7 then
    raise exception 'Regular requests need at least 7 days'' notice' using errcode = '22023';
  end if;
  if p_type = 'URGENT' and p_date not in (v_today, v_today + 1) then
    raise exception 'Urgent requests are for today or tomorrow only' using errcode = '22023';
  end if;
end;
$$;

-- Validates and inserts a request's destinations. Internal: only called
-- from the RPCs below, never directly by clients.
create function insert_request_destinations(p_request_id uuid, p_destinations jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_position int := 0;
  v_destination public.booking_options;
  v_purpose public.booking_options;
begin
  if p_destinations is null or jsonb_typeof(p_destinations) <> 'array'
     or jsonb_array_length(p_destinations) = 0 then
    raise exception 'Add at least one destination' using errcode = '22023';
  end if;
  if jsonb_array_length(p_destinations) > 20 then
    raise exception 'A request can have at most 20 destinations' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_destinations) loop
    v_position := v_position + 1;

    select * into v_destination from public.booking_options
    where "group" = 'destinations' and id = v_item ->> 'destinationId' and status = 'Active';
    if v_destination is null then
      raise exception 'Destination % is not an active option', v_position using errcode = '22023';
    end if;

    select * into v_purpose from public.booking_options
    where "group" = 'purposes' and id = v_item ->> 'purposeId' and status = 'Active';
    if v_purpose is null then
      raise exception 'Purpose for destination % is not an active option', v_position using errcode = '22023';
    end if;

    insert into public.request_destinations (
      request_id, position, destination_id, destination_name, purpose_id, purpose_name
    ) values (
      p_request_id, v_position, v_destination.id, v_destination.name, v_purpose.id, v_purpose.name
    );
  end loop;
end;
$$;

revoke execute on function insert_request_destinations(uuid, jsonb) from public;
revoke execute on function insert_request_destinations(uuid, jsonb) from anon;
revoke execute on function insert_request_destinations(uuid, jsonb) from authenticated;

-- Resolves the optional Project / Site into (id, name, is_other).
create function resolve_request_project(p_project_id text, p_project_other text)
returns table (project_id text, project_name text, project_is_other boolean)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_other text := coalesce(trim(p_project_other), '');
  v_option public.booking_options;
begin
  if nullif(p_project_id, '') is not null and v_other <> '' then
    raise exception 'Choose a Project / Site or enter Other, not both' using errcode = '22023';
  end if;
  if v_other <> '' then
    return query select null::text, v_other, true;
    return;
  end if;
  if nullif(p_project_id, '') is null then
    return query select null::text, ''::text, false;
    return;
  end if;
  select * into v_option from public.booking_options
  where "group" = 'projects' and id = p_project_id and status = 'Active';
  if v_option is null then
    raise exception 'Project / Site is not an active option' using errcode = '22023';
  end if;
  return query select v_option.id, v_option.name, false;
end;
$$;

revoke execute on function resolve_request_project(text, text) from public;
revoke execute on function resolve_request_project(text, text) from anon;
revoke execute on function resolve_request_project(text, text) from authenticated;

create function create_request(
  p_requested_date date,
  p_request_type text,
  p_project_id text,
  p_project_other text,
  p_destinations jsonb
) returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_project record;
  v_request public.requests;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Requester', 'Admin') then
    raise exception 'Not authorized to create requests' using errcode = '42501';
  end if;

  perform public.check_request_date(v_actor.role, p_requested_date, p_request_type);
  select * into v_project from public.resolve_request_project(p_project_id, p_project_other);

  perform set_config('kova.audit_action', 'request.create', true);

  insert into public.requests (
    owner_account_id, owner_name, requested_date, request_type,
    project_id, project_name, project_is_other
  ) values (
    v_actor.id, v_actor.name, p_requested_date, p_request_type,
    v_project.project_id, v_project.project_name, v_project.project_is_other
  ) returning * into v_request;

  perform public.insert_request_destinations(v_request.id, p_destinations);

  return v_request;
end;
$$;

revoke execute on function create_request(date, text, text, text, jsonb) from public;
revoke execute on function create_request(date, text, text, text, jsonb) from anon;
grant execute on function create_request(date, text, text, text, jsonb) to authenticated;

create function update_request(
  p_request_id uuid,
  p_expected_row_version integer,
  p_requested_date date,
  p_request_type text,
  p_project_id text,
  p_project_other text,
  p_destinations jsonb
) returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_existing public.requests;
  v_project record;
  v_request public.requests;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Requester', 'Admin') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_existing from public.requests where id = p_request_id for update;
  if v_existing is null or v_existing.owner_account_id <> v_actor.id then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_existing.status <> 'ACTIVE' then
    raise exception 'This request has been cancelled' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.schedule_requests where request_id = p_request_id and active
  ) then
    raise exception 'This request is already being scheduled and can no longer be edited' using errcode = '22023';
  end if;
  if v_existing.row_version <> p_expected_row_version then
    raise exception 'This request was changed elsewhere. Reload it and try again' using errcode = '40001';
  end if;

  if v_existing.requested_date is distinct from p_requested_date
     or v_existing.request_type is distinct from p_request_type then
    perform public.check_request_date(v_actor.role, p_requested_date, p_request_type);
  end if;
  select * into v_project from public.resolve_request_project(p_project_id, p_project_other);

  perform set_config('kova.audit_action', 'request.update', true);

  update public.request_destinations set active = false
  where request_id = p_request_id and active;
  perform public.insert_request_destinations(p_request_id, p_destinations);

  update public.requests set
    requested_date = p_requested_date,
    request_type = p_request_type,
    project_id = v_project.project_id,
    project_name = v_project.project_name,
    project_is_other = v_project.project_is_other,
    row_version = row_version + 1,
    updated_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

revoke execute on function update_request(uuid, integer, date, text, text, text, jsonb) from public;
revoke execute on function update_request(uuid, integer, date, text, text, text, jsonb) from anon;
grant execute on function update_request(uuid, integer, date, text, text, text, jsonb) to authenticated;

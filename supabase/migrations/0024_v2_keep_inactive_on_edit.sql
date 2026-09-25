-- v2.0: an edit may keep options the request already had, even if they
-- have since been made Inactive.
--
-- 0019 required every destination, purpose and Project / Site to be
-- Active on every save. That blocked a Requester from changing just the
-- date of a request whose destination an Admin had since deactivated.
-- Now update_request passes the request's current selections along, and
-- those are accepted whether Active or not, keeping their existing name
-- snapshot. Anything newly chosen must still be Active. create_request
-- passes nothing, so new requests are unchanged.

drop function insert_request_destinations(uuid, jsonb);

-- p_kept: the request's destinations before this edit, as
-- [{"destination_id", "destination_name", "purpose_id", "purpose_name"}].
create function insert_request_destinations(
  p_request_id uuid,
  p_destinations jsonb,
  p_kept jsonb default '[]'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_position int := 0;
  v_destination_name text;
  v_purpose_name text;
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

    select name into v_destination_name from public.booking_options
    where "group" = 'destinations' and id = v_item ->> 'destinationId' and status = 'Active';
    if v_destination_name is null then
      select k ->> 'destination_name' into v_destination_name
      from jsonb_array_elements(coalesce(p_kept, '[]')) k
      where k ->> 'destination_id' = v_item ->> 'destinationId'
      limit 1;
    end if;
    if v_destination_name is null then
      raise exception 'Destination % is not an active option', v_position using errcode = '22023';
    end if;

    select name into v_purpose_name from public.booking_options
    where "group" = 'purposes' and id = v_item ->> 'purposeId' and status = 'Active';
    if v_purpose_name is null then
      select k ->> 'purpose_name' into v_purpose_name
      from jsonb_array_elements(coalesce(p_kept, '[]')) k
      where k ->> 'purpose_id' = v_item ->> 'purposeId'
      limit 1;
    end if;
    if v_purpose_name is null then
      raise exception 'Purpose for destination % is not an active option', v_position using errcode = '22023';
    end if;

    insert into public.request_destinations (
      request_id, position, destination_id, destination_name, purpose_id, purpose_name
    ) values (
      p_request_id, v_position, v_item ->> 'destinationId', v_destination_name,
      v_item ->> 'purposeId', v_purpose_name
    );
  end loop;
end;
$$;

revoke execute on function insert_request_destinations(uuid, jsonb, jsonb) from public;
revoke execute on function insert_request_destinations(uuid, jsonb, jsonb) from anon;
revoke execute on function insert_request_destinations(uuid, jsonb, jsonb) from authenticated;

drop function resolve_request_project(text, text);

-- p_kept_id / p_kept_name: the request's Project / Site before this edit.
create function resolve_request_project(
  p_project_id text,
  p_project_other text,
  p_kept_id text default null,
  p_kept_name text default null
)
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
  if v_option is not null then
    return query select v_option.id, v_option.name, false;
    return;
  end if;
  if p_project_id = p_kept_id then
    return query select p_kept_id, p_kept_name, false;
    return;
  end if;
  raise exception 'Project / Site is not an active option' using errcode = '22023';
end;
$$;

revoke execute on function resolve_request_project(text, text, text, text) from public;
revoke execute on function resolve_request_project(text, text, text, text) from anon;
revoke execute on function resolve_request_project(text, text, text, text) from authenticated;

-- Same as 0019 except that it hands the request's current selections to
-- the two helpers above.
create or replace function update_request(
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
  v_kept jsonb;
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
  select * into v_project from public.resolve_request_project(
    p_project_id, p_project_other,
    case when v_existing.project_is_other then null else v_existing.project_id end,
    v_existing.project_name
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'destination_id', destination_id, 'destination_name', destination_name,
    'purpose_id', purpose_id, 'purpose_name', purpose_name
  )), '[]') into v_kept
  from public.request_destinations
  where request_id = p_request_id and active;

  perform set_config('kova.audit_action', 'request.update', true);

  update public.request_destinations set active = false
  where request_id = p_request_id and active;
  perform public.insert_request_destinations(p_request_id, p_destinations, v_kept);

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

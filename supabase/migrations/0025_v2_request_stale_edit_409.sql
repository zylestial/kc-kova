-- v2.0: stale request edits fail fast with HTTP 409 instead of hanging.
--
-- update_request reported a stale row_version with SQLSTATE 40001
-- (serialization_failure). PostgREST treats 40001 as a transient conflict
-- and retries the whole transaction, and since the version check fails the
-- same way every time, the retry never ends: the API call hangs until the
-- gateway times out while Postgres keeps re-running it. PT409 is
-- PostgREST's code for "respond 409", which it never retries.
--
-- Same as 0024 otherwise.
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
    raise exception 'This request was changed elsewhere. Reload it and try again' using errcode = 'PT409';
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

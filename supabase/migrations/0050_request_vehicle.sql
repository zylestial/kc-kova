-- The Requester chooses the vehicle on the request form, not the Scheduler
-- (owner's call, 2026-10-14). The vehicle's assigned Driver comes with it.
-- Choosing a vehicle reserves nothing: several requests may name the same
-- vehicle for a day, and they share that vehicle's one trip (0048). A
-- schedule may only include requests for its own vehicle. Requests made
-- before this have no vehicle and may go on any vehicle.

alter table requests add column vehicle_plate text references vehicles (plate);

-- The vehicle for a request: p_plate if it's Active with an active Driver,
-- or p_kept unchanged (the request's vehicle before this edit) even if it
-- has since become Inactive, as 0024 does for options. Internal: called by
-- create_request/update_request, never by clients.
create function resolve_request_vehicle(p_plate text, p_kept text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle public.vehicles;
begin
  if coalesce(p_plate, '') = '' then
    raise exception 'Select a vehicle' using errcode = '22023';
  end if;
  if p_plate = p_kept then
    return p_kept;
  end if;
  select * into v_vehicle from public.vehicles where plate = p_plate;
  if v_vehicle is null or v_vehicle.status <> 'Active' then
    raise exception 'Select an active vehicle' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.accounts
    where id = v_vehicle.assigned_driver_id and role = 'Driver' and status = 'Active'
  ) then
    raise exception 'This vehicle has no Driver assigned' using errcode = '22023';
  end if;
  return v_vehicle.plate;
end;
$$;

revoke execute on function resolve_request_vehicle(text, text) from public, anon, authenticated;

-- create_request: same as 0019, plus the vehicle.
drop function create_request(date, text, text, text, jsonb);

create function create_request(
  p_requested_date date,
  p_request_type text,
  p_project_id text,
  p_project_other text,
  p_destinations jsonb,
  p_vehicle_plate text
) returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_project record;
  v_plate text;
  v_request public.requests;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Requester', 'Admin') then
    raise exception 'Not authorized to create requests' using errcode = '42501';
  end if;

  perform public.check_request_date(v_actor.role, p_requested_date, p_request_type);
  select * into v_project from public.resolve_request_project(p_project_id, p_project_other);
  v_plate := public.resolve_request_vehicle(p_vehicle_plate);

  perform set_config('kova.audit_action', 'request.create', true);

  insert into public.requests (
    owner_account_id, owner_name, requested_date, request_type,
    project_id, project_name, project_is_other, vehicle_plate
  ) values (
    v_actor.id, v_actor.name, p_requested_date, p_request_type,
    v_project.project_id, v_project.project_name, v_project.project_is_other, v_plate
  ) returning * into v_request;

  perform public.insert_request_destinations(v_request.id, p_destinations);

  return v_request;
end;
$$;

revoke execute on function create_request(date, text, text, text, jsonb, text) from public, anon;
grant execute on function create_request(date, text, text, text, jsonb, text) to authenticated;

-- update_request: same as 0025, plus the vehicle. A request sent back
-- (0038) whose vehicle is changed is a fresh request for the pool again,
-- as when its date changes: the usual reason to send one back is that its
-- vehicle is already taken that day.
drop function update_request(uuid, integer, date, text, text, text, jsonb);

create function update_request(
  p_request_id uuid,
  p_expected_row_version integer,
  p_requested_date date,
  p_request_type text,
  p_project_id text,
  p_project_other text,
  p_destinations jsonb,
  p_vehicle_plate text
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
  v_plate text;
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
  v_plate := public.resolve_request_vehicle(p_vehicle_plate, v_existing.vehicle_plate);

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
    vehicle_plate = v_plate,
    sent_back_at = case when v_plate is distinct from vehicle_plate then null else sent_back_at end,
    sent_back_by_account_id = case when v_plate is distinct from vehicle_plate then null else sent_back_by_account_id end,
    sent_back_reason = case when v_plate is distinct from vehicle_plate then '' else sent_back_reason end,
    row_version = row_version + 1,
    updated_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

revoke execute on function update_request(uuid, integer, date, text, text, text, jsonb, text) from public, anon;
grant execute on function update_request(uuid, integer, date, text, text, text, jsonb, text) to authenticated;

-- split_request: same as 0039, except the split-off part keeps the
-- request's vehicle.
create or replace function split_request(p_request_id uuid, p_destination_ids uuid[])
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
    project_id, project_name, project_is_other, vehicle_plate
  ) values (
    v_request.owner_account_id, v_request.owner_name, v_request.requested_date, v_request.request_type,
    v_request.project_id, v_request.project_name, v_request.project_is_other, v_request.vehicle_plate
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

-- rename_vehicle: same as 0032, plus requests move to the new plate. A
-- rename inserts the new row and deletes the old one, so a foreign key
-- cascade wouldn't carry them.
create or replace function rename_vehicle(
  p_old_plate text,
  p_new_plate text,
  p_name text,
  p_status text,
  p_assigned_driver_id uuid
)
returns public.vehicles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_vehicle public.vehicles;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_status not in ('Active', 'Inactive') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;

  if not exists (select 1 from public.vehicles where plate = p_old_plate) then
    raise exception 'Vehicle not found' using errcode = 'P0002';
  end if;

  -- Deliberately NOT errcode '23505' (unique_violation): this function's own
  -- "exception when unique_violation" handler below would catch a raise with
  -- that code too and rewrite it to "Plate already in use", masking this
  -- distinct error. Default (P0001) avoids that self-catch.
  if p_assigned_driver_id is not null and exists (
    select 1 from public.vehicles where assigned_driver_id = p_assigned_driver_id and plate <> p_old_plate
  ) then
    raise exception 'That Driver is already assigned to another vehicle';
  end if;

  if p_new_plate = p_old_plate then
    update public.vehicles set name = p_name, status = p_status, assigned_driver_id = p_assigned_driver_id
    where plate = p_old_plate
    returning * into v_vehicle;
    return v_vehicle;
  end if;

  if exists (select 1 from public.vehicles where plate = p_new_plate) then
    raise exception 'Plate already in use' using errcode = '23505';
  end if;

  -- assigned_driver_id is deliberately left null on this insert: the old
  -- row (below, still not yet deleted) may carry the same
  -- assigned_driver_id, and both rows existing at once would trip
  -- vehicles_assigned_driver_id_unique. Set it once the old row is gone.
  insert into public.vehicles (plate, name, status) values (p_new_plate, p_name, p_status);

  update public.schedule_revisions set plate = p_new_plate where plate = p_old_plate;
  update public.schedule_reservations set plate = p_new_plate where plate = p_old_plate;
  update public.requests set vehicle_plate = p_new_plate where vehicle_plate = p_old_plate;

  delete from public.vehicles where plate = p_old_plate;

  update public.vehicles set assigned_driver_id = p_assigned_driver_id
  where plate = p_new_plate
  returning * into v_vehicle;

  return v_vehicle;
exception
  when unique_violation then
    raise exception 'Plate already in use' using errcode = '23505';
end;
$$;

-- A schedule takes only requests for its own vehicle, however the route is
-- written. write_revision_content rewrites revision_requests on every save,
-- after save_schedule_draft sets the revision's plate.
create function enforce_request_vehicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plate text;
  v_wanted text;
begin
  select plate into v_plate from public.schedule_revisions where id = new.revision_id;
  select vehicle_plate into v_wanted from public.requests where id = new.request_id;
  if v_wanted is not null and v_wanted <> v_plate then
    raise exception 'A selected request is for %, not %. Remove it from this trip', v_wanted, v_plate using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function enforce_request_vehicle() from public, anon, authenticated;

create trigger revision_requests_request_vehicle
  before insert or update on revision_requests
  for each row execute function enforce_request_vehicle();

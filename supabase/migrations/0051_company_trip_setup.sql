-- Company Trip setup (owner's calls, 2026-10-14; prototype "KOVA Company
-- Trip Flow"): who may ask for which kind of trip, the Driver type, which
-- vehicles can be requested for company trips, and the new Request choices.
--
-- * Requesters and Admins can always make Daily Vehicle Trip requests.
--   Company Trips need "Can request company trips" on the account, and a
--   Position (it prints on the Company Trip Form).
-- * A Driver is a Truck driver or a Company car driver. Drivers can't make
--   requests unless an Admin allows that account, with Daily requests and
--   Company trips switched on separately. A Truck driver can never be
--   allowed.
-- * A vehicle that "Can be requested for company trips" is offered on the
--   Company Trip form. Off by default.

alter table accounts
  add column position text not null default '',
  add column driver_type text check (driver_type in ('Truck', 'Company car')),
  add column can_request_daily boolean not null default false,
  add column can_request_company boolean not null default false;

update accounts set driver_type = 'Truck' where role = 'Driver';

-- A new Driver starts as a Truck driver, and someone who stops being a
-- Driver loses the Driver-only fields, so account saves that don't know
-- about them (seeds, older callers) stay valid.
create function normalize_driver_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'Driver' then
    new.driver_type := coalesce(new.driver_type, 'Truck');
  else
    new.driver_type := null;
    new.can_request_daily := false;
  end if;
  return new;
end;
$$;

create trigger accounts_normalize_driver_fields
  before insert or update of role, driver_type, can_request_daily on accounts
  for each row execute function normalize_driver_fields();

alter table accounts
  -- Every Driver has a type; nobody else does.
  add constraint accounts_driver_type_for_drivers check ((role = 'Driver') = (driver_type is not null)),
  -- The Daily switch only means something on a Driver: Requesters and Admins always can.
  add constraint accounts_daily_switch_drivers_only check (not can_request_daily or role = 'Driver'),
  add constraint accounts_company_switch_roles check (not can_request_company or role in ('Requester', 'Admin', 'Driver')),
  add constraint accounts_truck_drivers_cannot_request check (
    driver_type is distinct from 'Truck' or not (can_request_daily or can_request_company)
  ),
  add constraint accounts_company_trips_need_position check (not can_request_company or trim(position) <> '');

alter table vehicles add column company_trips boolean not null default false;

alter table booking_options drop constraint booking_options_group_check;
alter table booking_options add constraint booking_options_group_check check ("group" in (
  'projects', 'destinations', 'purposes',
  -- Company Trip form and per-stop Urgent (Request choices, Admin-managed).
  'departments', 'suppliers', 'supervisors', 'heads', 'starting_points', 'urgent_reasons'
));

-- Whether this account may make Daily Vehicle Trip requests.
-- lib/request-access.ts mirrors these three for the menus.
create function can_request_daily(p_account public.accounts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_account.id is not null
    and p_account.status = 'Active'
    and (
      p_account.role in ('Requester', 'Admin')
      or (p_account.role = 'Driver' and p_account.driver_type = 'Company car' and p_account.can_request_daily)
    );
$$;

-- Whether this account may make Company Trip requests.
create function can_request_company(p_account public.accounts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_account.id is not null
    and p_account.status = 'Active'
    and p_account.can_request_company
    and (p_account.role in ('Requester', 'Admin') or (p_account.role = 'Driver' and p_account.driver_type = 'Company car'));
$$;

-- Whether this account may edit and cancel its own requests: it can make
-- either kind.
create function can_request_transport(p_account public.accounts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_request_daily(p_account) or public.can_request_company(p_account);
$$;

revoke execute on function can_request_daily(public.accounts) from public, anon, authenticated;
revoke execute on function can_request_company(public.accounts) from public, anon, authenticated;
revoke execute on function can_request_transport(public.accounts) from public, anon, authenticated;

-- resolve_request_vehicle: replaces 0050's. Daily requests name no vehicle
-- (null). A vehicle, once chosen, must be Active and one that can be
-- requested for company trips; the request's current vehicle (p_kept) is
-- kept unchanged even if that has since changed. Company trip vehicles
-- have no fixed Driver: the requester picks one (Company Trip form).
create or replace function resolve_request_vehicle(p_plate text, p_kept text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle public.vehicles;
begin
  if coalesce(p_plate, '') = '' then
    return null;
  end if;
  if p_plate = p_kept then
    return p_kept;
  end if;
  select * into v_vehicle from public.vehicles where plate = p_plate;
  if v_vehicle is null or v_vehicle.status <> 'Active' then
    raise exception 'Select an active vehicle' using errcode = '22023';
  end if;
  if not v_vehicle.company_trips then
    raise exception 'This vehicle can''t be requested for company trips' using errcode = '22023';
  end if;
  return v_vehicle.plate;
end;
$$;

-- create_request: same as 0050, but who may ask is can_request_daily (the
-- Daily form is the only one until the Company Trip form arrives), and the
-- vehicle is optional.
create or replace function create_request(
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
  if not public.can_request_daily(v_actor) then
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

-- update_request: same as 0050, but who may edit is can_request_transport.
create or replace function update_request(
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
  if not public.can_request_transport(v_actor) then
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

-- cancel_request: same as 0028, but who may cancel is can_request_transport.
create or replace function cancel_request(p_request_id uuid)
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
  if not public.can_request_transport(v_actor) then
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

-- request_cancellation: same as 0035, but who may ask is can_request_transport.
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
  if not public.can_request_transport(v_actor) then
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

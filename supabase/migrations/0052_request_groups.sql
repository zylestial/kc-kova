-- Request groups and stops (owner's calls, 2026-10-14; prototypes "KOVA
-- New Request" and "KOVA Company Trip Flow").
--
-- A request is now a group of stops, numbered 52-A, 52-B, ... Each stop is
-- its own requests row with one request_destinations row, so the Planner
-- can put stops on different vehicles or days, exactly as it already plans
-- a request. The group holds what is shared: the form (Daily Vehicle Trip
-- or Company Trip), the date, and the Company Trip's fields.
--
-- Per stop: project, destination, purpose or an Urgent reason (Admin list),
-- details (what exactly; required for Pick up, Delivery and Urgent stops),
-- how flexible it is (any time that day / a fixed time / any day that
-- week), a contact and, on a Company Trip, a supplier.
--
-- The date no longer sets Regular/Urgent: any date from today on (an Admin
-- may also pick a past date), and a stop is Urgent when it has a reason.
-- request_type stays, set from that, so existing screens keep working.
--
-- create_request / update_request (0051) stay for requests made before
-- this; the app's forms use create_request_group / update_request_group.

create table request_groups (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  owner_account_id uuid not null references accounts (id),
  owner_name text not null,
  form_type text not null check (form_type in ('DAILY', 'COMPANY')),
  requested_date date not null,
  -- Company Trip only: option id + name snapshots, like project_id/name.
  starting_point_id text,
  starting_point_name text not null default '',
  department_id text,
  department_name text not null default '',
  vehicle_plate text references vehicles (plate),
  driver_id uuid references accounts (id),
  driver_name text not null default '',
  supervisor_id text,
  supervisor_name text not null default '',
  head_id text,
  head_name text not null default '',
  site_officer text not null default '',
  site_company text not null default '',
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (form_type = 'COMPANY' or (vehicle_plate is null and driver_id is null))
);

create trigger request_groups_audit
  after insert or update or delete on request_groups
  for each row execute function write_audit_event();

create index request_groups_owner_account_id_idx on request_groups (owner_account_id);
create index request_groups_driver_id_idx on request_groups (driver_id);

alter table requests
  add column group_id uuid references request_groups (id),
  add column stop_letter text not null default '',
  add column urgent_reason_id text,
  add column urgent_reason_name text not null default '',
  add column details text not null default '' check (char_length(details) <= 150),
  add column flexibility text not null default 'DAY' check (flexibility in ('DAY', 'FIXED', 'WEEK')),
  add column fixed_time time(0),
  add column contact text not null default '' check (char_length(contact) <= 100),
  add column supplier_id text,
  add column supplier_name text not null default '',
  add constraint requests_fixed_time_check check ((flexibility = 'FIXED') = (fixed_time is not null));

create index requests_group_id_idx on requests (group_id);

-- Owner, Admins and Schedulers, the Company Trip's Driver, and anyone who
-- may see one of its stops.
create function can_view_request_group(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select public.current_account_role()) in ('Admin', 'Scheduler')
    or exists (
      select 1 from public.request_groups g
      where g.id = p_group_id
        and (g.owner_account_id = (select auth.uid()) or g.driver_id = (select auth.uid()))
    )
    or exists (
      select 1 from public.requests r
      where r.group_id = p_group_id and public.can_view_request_details(r.id)
    );
$$;
revoke execute on function can_view_request_group(uuid) from public, anon;
grant execute on function can_view_request_group(uuid) to authenticated;

alter table request_groups enable row level security;
grant select on request_groups to authenticated;
create policy request_groups_select on request_groups for select
  using (can_view_request_group(id));

-- An Active option of the group, or the kept one unchanged (an edit may
-- keep a choice made Inactive since, as 0024 does). Null for a blank id
-- when p_label is null (optional); otherwise blank raises "<label> is
-- required". Internal.
create function resolve_choice(
  p_group text,
  p_id text,
  p_label text,
  p_kept_id text default null,
  p_kept_name text default null
)
returns table (id text, name text)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_option public.booking_options;
begin
  if nullif(p_id, '') is null then
    if p_label is not null then
      raise exception '% is required', p_label using errcode = '22023';
    end if;
    return query select null::text, ''::text;
    return;
  end if;
  select * into v_option from public.booking_options o
  where o."group" = p_group and o.id = p_id and o.status = 'Active';
  if v_option.id is not null then
    return query select v_option.id, v_option.name;
    return;
  end if;
  if p_id = p_kept_id then
    return query select p_kept_id, coalesce(p_kept_name, '');
    return;
  end if;
  raise exception '% is not an active choice', coalesce(p_label, 'That choice') using errcode = '22023';
end;
$$;
revoke execute on function resolve_choice(text, text, text, text, text) from public, anon, authenticated;

-- Checks and writes the group's own fields from p_input (the date, and for
-- a Company Trip its fields), keeping p_kept's choices as resolve_choice
-- does. Returns the values to store; inserts nothing. Internal.
create function resolve_group_fields(
  p_actor public.accounts,
  p_form_type text,
  p_input jsonb,
  p_kept public.request_groups default null
)
returns public.request_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.request_groups;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_choice record;
  v_driver public.accounts;
begin
  v_group.form_type := p_form_type;
  -- A Daily request has none of the Company Trip fields.
  v_group.starting_point_name := '';
  v_group.department_name := '';
  v_group.driver_name := '';
  v_group.supervisor_name := '';
  v_group.head_name := '';
  v_group.site_officer := '';
  v_group.site_company := '';
  v_group.requested_date := nullif(p_input ->> 'date', '')::date;
  if v_group.requested_date is null then
    raise exception 'Select a date' using errcode = '22023';
  end if;
  if v_group.requested_date < v_today and p_actor.role <> 'Admin'
     and v_group.requested_date is distinct from p_kept.requested_date then
    raise exception 'That date has passed. Choose today or a later date' using errcode = '22023';
  end if;

  if p_form_type = 'DAILY' then
    return v_group;
  end if;

  select * into v_choice from public.resolve_choice('starting_points', p_input ->> 'startingPointId', 'Starting point',
    p_kept.starting_point_id, p_kept.starting_point_name);
  v_group.starting_point_id := v_choice.id;
  v_group.starting_point_name := v_choice.name;
  select * into v_choice from public.resolve_choice('departments', p_input ->> 'departmentId', 'Department / Site',
    p_kept.department_id, p_kept.department_name);
  v_group.department_id := v_choice.id;
  v_group.department_name := v_choice.name;
  select * into v_choice from public.resolve_choice('supervisors', p_input ->> 'supervisorId', 'Immediate Supervisor',
    p_kept.supervisor_id, p_kept.supervisor_name);
  v_group.supervisor_id := v_choice.id;
  v_group.supervisor_name := v_choice.name;
  select * into v_choice from public.resolve_choice('heads', p_input ->> 'headId', 'Project Manager / Construction Manager / Dept. Head',
    p_kept.head_id, p_kept.head_name);
  v_group.head_id := v_choice.id;
  v_group.head_name := v_choice.name;

  v_group.vehicle_plate := public.resolve_request_vehicle(p_input ->> 'vehiclePlate', p_kept.vehicle_plate);
  if v_group.vehicle_plate is null then
    raise exception 'Select a vehicle' using errcode = '22023';
  end if;

  if nullif(p_input ->> 'driverId', '') is null then
    raise exception 'Select a Driver' using errcode = '22023';
  end if;
  select * into v_driver from public.accounts where id = (p_input ->> 'driverId')::uuid;
  if v_driver.id is not null and v_driver.id = p_kept.driver_id then
    v_group.driver_id := p_kept.driver_id;
    v_group.driver_name := p_kept.driver_name;
  elsif v_driver.id is null or v_driver.role <> 'Driver' or v_driver.status <> 'Active'
        or v_driver.driver_type is distinct from 'Company car' then
    raise exception 'Select an active Company car driver' using errcode = '22023';
  else
    v_group.driver_id := v_driver.id;
    v_group.driver_name := v_driver.name;
  end if;

  v_group.site_officer := left(coalesce(trim(p_input ->> 'siteOfficer'), ''), 100);
  v_group.site_company := left(coalesce(trim(p_input ->> 'siteCompany'), ''), 100);
  return v_group;
end;
$$;
revoke execute on function resolve_group_fields(public.accounts, text, jsonb, public.request_groups) from public, anon, authenticated;

-- Writes one stop: inserts a requests row (p_request_id null) or updates
-- that one, and replaces its request_destinations row. Internal.
create function write_request_stop(
  p_group public.request_groups,
  p_request_id uuid,
  p_letter text,
  p_stop jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kept public.requests;
  v_kept_dest public.request_destinations;
  v_company boolean := p_group.form_type = 'COMPANY';
  v_label text := 'Stop ' || p_letter;
  v_project record;
  v_choice record;
  v_urgent_id text;
  v_urgent_name text := '';
  v_dest_id text;
  v_dest_name text;
  v_dest_is_other boolean := false;
  v_dest_other text := coalesce(trim(p_stop ->> 'destinationOther'), '');
  v_purpose_id text;
  v_purpose_name text;
  v_purpose_is_other boolean := false;
  v_purpose_other text := coalesce(trim(p_stop ->> 'purposeOther'), '');
  v_details text := coalesce(trim(p_stop ->> 'details'), '');
  v_flexibility text := coalesce(nullif(p_stop ->> 'flexibility', ''), 'DAY');
  v_fixed_time time(0);
  v_supplier_id text;
  v_supplier_name text := '';
  v_typed public.booking_options;
  v_request_id uuid := p_request_id;
  v_resend boolean := false;
begin
  if p_request_id is not null then
    select * into v_kept from public.requests where id = p_request_id;
    select * into v_kept_dest from public.request_destinations where request_id = p_request_id and active limit 1;
    v_resend := p_group.requested_date is distinct from v_kept.requested_date
      or p_group.vehicle_plate is distinct from v_kept.vehicle_plate;
  end if;

  -- Project / Site: required on every stop (Daily may type Other).
  if v_company and coalesce(trim(p_stop ->> 'projectOther'), '') <> '' then
    raise exception '%: choose the Project / Site from the list', v_label using errcode = '22023';
  end if;
  select * into v_project from public.resolve_request_project(
    p_stop ->> 'projectId', p_stop ->> 'projectOther',
    case when v_kept.project_is_other then null else v_kept.project_id end, v_kept.project_name);
  if v_project.project_name = '' then
    raise exception '%: Project / Site is required', v_label using errcode = '22023';
  end if;

  -- Destination: from the list (not a Scheduler's fuel/errand stop), or
  -- typed on a Daily request (0049 turns a new name into a choice).
  if v_dest_other <> '' then
    if v_company then
      raise exception '%: choose the destination from the list', v_label using errcode = '22023';
    end if;
    v_typed := public.choice_for_typed_name('destinations', v_dest_other);
    if v_typed.id is not null then
      v_dest_id := v_typed.id;
      v_dest_name := v_typed.name;
    else
      v_dest_name := v_dest_other;
      v_dest_is_other := true;
    end if;
  else
    select o.id, o.name into v_dest_id, v_dest_name from public.booking_options o
    where o."group" = 'destinations' and o.id = nullif(p_stop ->> 'destinationId', '') and o.status = 'Active' and not o.is_other_stop;
    if v_dest_id is null and nullif(p_stop ->> 'destinationId', '') = v_kept_dest.destination_id then
      v_dest_id := v_kept_dest.destination_id;
      v_dest_name := v_kept_dest.destination_name;
    end if;
    if v_dest_id is null then
      raise exception '%: choose a destination', v_label using errcode = '22023';
    end if;
  end if;

  -- Urgent with a reason, or Regular with a purpose.
  if nullif(p_stop ->> 'urgentReasonId', '') is not null then
    select * into v_choice from public.resolve_choice('urgent_reasons', p_stop ->> 'urgentReasonId', 'Urgent reason',
      v_kept.urgent_reason_id, v_kept.urgent_reason_name);
    v_urgent_id := v_choice.id;
    v_urgent_name := v_choice.name;
    v_purpose_name := v_urgent_name;
  elsif v_purpose_other <> '' then
    if v_company then
      raise exception '%: choose the purpose from the list', v_label using errcode = '22023';
    end if;
    v_typed := public.choice_for_typed_name('purposes', v_purpose_other);
    if v_typed.id is not null then
      v_purpose_id := v_typed.id;
      v_purpose_name := v_typed.name;
    else
      v_purpose_name := v_purpose_other;
      v_purpose_is_other := true;
    end if;
  else
    select * into v_choice from public.resolve_choice('purposes', p_stop ->> 'purposeId', v_label || ': Purpose',
      v_kept_dest.purpose_id, v_kept_dest.purpose_name);
    v_purpose_id := v_choice.id;
    v_purpose_name := v_choice.name;
  end if;

  if v_details = '' and (v_urgent_id is not null or lower(v_purpose_name) in ('pick up', 'pickup', 'delivery')) then
    raise exception '%: add the details, e.g. what to pick up or deliver', v_label using errcode = '22023';
  end if;
  if char_length(v_details) > 150 then
    raise exception '%: details can be at most 150 characters', v_label using errcode = '22023';
  end if;

  if v_flexibility not in ('DAY', 'FIXED', 'WEEK') then
    raise exception '%: choose how flexible this stop is', v_label using errcode = '22023';
  end if;
  if v_flexibility = 'FIXED' then
    v_fixed_time := nullif(p_stop ->> 'fixedTime', '')::time(0);
    if v_fixed_time is null then
      raise exception '%: add the appointment time', v_label using errcode = '22023';
    end if;
  end if;

  if v_company then
    select * into v_choice from public.resolve_choice('suppliers', p_stop ->> 'supplierId', null,
      v_kept.supplier_id, v_kept.supplier_name);
    v_supplier_id := v_choice.id;
    v_supplier_name := v_choice.name;
  end if;

  if v_request_id is null then
    insert into public.requests (
      owner_account_id, owner_name, requested_date, request_type,
      project_id, project_name, project_is_other, vehicle_plate,
      group_id, stop_letter, urgent_reason_id, urgent_reason_name, details,
      flexibility, fixed_time, contact, supplier_id, supplier_name
    ) values (
      p_group.owner_account_id, p_group.owner_name, p_group.requested_date,
      case when v_urgent_id is null then 'REGULAR' else 'URGENT' end,
      v_project.project_id, v_project.project_name, v_project.project_is_other, p_group.vehicle_plate,
      p_group.id, p_letter, v_urgent_id, v_urgent_name, v_details,
      v_flexibility, v_fixed_time, left(coalesce(trim(p_stop ->> 'contact'), ''), 100), v_supplier_id, v_supplier_name
    ) returning id into v_request_id;
  else
    update public.requests set
      requested_date = p_group.requested_date,
      request_type = case when v_urgent_id is null then 'REGULAR' else 'URGENT' end,
      project_id = v_project.project_id,
      project_name = v_project.project_name,
      project_is_other = v_project.project_is_other,
      vehicle_plate = p_group.vehicle_plate,
      urgent_reason_id = v_urgent_id,
      urgent_reason_name = v_urgent_name,
      details = v_details,
      flexibility = v_flexibility,
      fixed_time = v_fixed_time,
      contact = left(coalesce(trim(p_stop ->> 'contact'), ''), 100),
      supplier_id = v_supplier_id,
      supplier_name = v_supplier_name,
      -- A new date or vehicle makes a sent-back stop a fresh request again
      -- (0050); on the right of SET these columns still hold the old values.
      sent_back_at = case when v_resend then null else sent_back_at end,
      sent_back_by_account_id = case when v_resend then null else sent_back_by_account_id end,
      sent_back_reason = case when v_resend then '' else sent_back_reason end,
      row_version = row_version + 1,
      updated_at = now()
    where id = v_request_id;
    update public.request_destinations set active = false where request_id = v_request_id and active;
  end if;

  insert into public.request_destinations (
    request_id, position, destination_id, destination_name, destination_is_other,
    purpose_id, purpose_name, purpose_is_other
  ) values (
    v_request_id, 1, v_dest_id, v_dest_name, v_dest_is_other,
    v_purpose_id, v_purpose_name, v_purpose_is_other
  );
  return v_request_id;
end;
$$;
revoke execute on function write_request_stop(public.request_groups, uuid, text, jsonb) from public, anon, authenticated;

-- The next unused stop letter in a group: A, B, ... (at most 20 stops).
create function next_stop_letter(p_group_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select chr(65 + count(*)::int) from public.requests where group_id = p_group_id;
$$;
revoke execute on function next_stop_letter(uuid) from public, anon, authenticated;

-- A new request: p_input is {date, stops: [...], and for a Company Trip
-- startingPointId, departmentId, vehiclePlate, driverId, supervisorId,
-- headId, siteOfficer, siteCompany}. Each stop is {projectId, projectOther,
-- destinationId, destinationOther, purposeId, purposeOther,
-- urgentReasonId, details, flexibility, fixedTime, contact, supplierId}.
create function create_request_group(p_form_type text, p_input jsonb)
returns public.request_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_fields public.request_groups;
  v_group public.request_groups;
  v_stops jsonb := coalesce(p_input -> 'stops', '[]');
  v_stop jsonb;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if p_form_type not in ('DAILY', 'COMPANY') then
    raise exception 'Choose the Daily Vehicle Trip or Company Trip form' using errcode = '22023';
  end if;
  if (p_form_type = 'DAILY' and not public.can_request_daily(v_actor))
     or (p_form_type = 'COMPANY' and not public.can_request_company(v_actor)) then
    raise exception 'Not authorized to create requests' using errcode = '42501';
  end if;
  if jsonb_typeof(v_stops) <> 'array' or jsonb_array_length(v_stops) = 0 then
    raise exception 'Add at least one destination' using errcode = '22023';
  end if;
  if jsonb_array_length(v_stops) > 20 then
    raise exception 'A request can have at most 20 destinations' using errcode = '22023';
  end if;

  v_fields := public.resolve_group_fields(v_actor, p_form_type, p_input);
  perform set_config('kova.audit_action', 'request.create', true);

  insert into public.request_groups (
    owner_account_id, owner_name, form_type, requested_date,
    starting_point_id, starting_point_name, department_id, department_name,
    vehicle_plate, driver_id, driver_name, supervisor_id, supervisor_name,
    head_id, head_name, site_officer, site_company
  ) values (
    v_actor.id, v_actor.name, p_form_type, v_fields.requested_date,
    v_fields.starting_point_id, v_fields.starting_point_name, v_fields.department_id, v_fields.department_name,
    v_fields.vehicle_plate, v_fields.driver_id, v_fields.driver_name, v_fields.supervisor_id, v_fields.supervisor_name,
    v_fields.head_id, v_fields.head_name, v_fields.site_officer, v_fields.site_company
  ) returning * into v_group;

  for v_stop in select value from jsonb_array_elements(v_stops) loop
    perform public.write_request_stop(v_group, null, public.next_stop_letter(v_group.id), v_stop);
  end loop;
  return v_group;
end;
$$;
revoke execute on function create_request_group(text, jsonb) from public, anon;
grant execute on function create_request_group(text, jsonb) to authenticated;

-- An edit. Stops already in a schedule stay as they are and can't be
-- removed here (ask for their cancellation instead), and while any stop is
-- in one the date and Company Trip fields stay too. A stop with an "id" is
-- that stop, edited; one without is added; an unscheduled stop left out is
-- cancelled.
create function update_request_group(p_group_id uuid, p_expected_row_version integer, p_input jsonb)
returns public.request_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_existing public.request_groups;
  v_fields public.request_groups;
  v_group public.request_groups;
  v_stops jsonb := coalesce(p_input -> 'stops', '[]');
  v_stop jsonb;
  v_stop_id uuid;
  v_kept_ids uuid[] := '{}';
  v_scheduled boolean;
  v_request public.requests;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if not public.can_request_transport(v_actor) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_existing from public.request_groups where id = p_group_id for update;
  if v_existing.id is null or v_existing.owner_account_id <> v_actor.id then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_existing.row_version <> p_expected_row_version then
    raise exception 'This request was changed elsewhere. Reload it and try again' using errcode = 'PT409';
  end if;
  if jsonb_typeof(v_stops) <> 'array' then
    raise exception 'Add at least one destination' using errcode = '22023';
  end if;

  perform 1 from public.requests where group_id = p_group_id order by id for update;
  v_scheduled := exists (
    select 1 from public.schedule_requests sr join public.requests r on r.id = sr.request_id
    where r.group_id = p_group_id and sr.active
  );

  v_fields := public.resolve_group_fields(v_actor, v_existing.form_type, p_input, v_existing);
  if v_scheduled and (
    v_fields.requested_date is distinct from v_existing.requested_date
    or v_fields.starting_point_id is distinct from v_existing.starting_point_id
    or v_fields.department_id is distinct from v_existing.department_id
    or v_fields.vehicle_plate is distinct from v_existing.vehicle_plate
    or v_fields.driver_id is distinct from v_existing.driver_id
    or v_fields.supervisor_id is distinct from v_existing.supervisor_id
    or v_fields.head_id is distinct from v_existing.head_id
  ) then
    raise exception 'Part of this request is already being scheduled, so its date and trip details can no longer be changed' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'request.update', true);

  update public.request_groups set
    requested_date = v_fields.requested_date,
    starting_point_id = v_fields.starting_point_id,
    starting_point_name = v_fields.starting_point_name,
    department_id = v_fields.department_id,
    department_name = v_fields.department_name,
    vehicle_plate = v_fields.vehicle_plate,
    driver_id = v_fields.driver_id,
    driver_name = v_fields.driver_name,
    supervisor_id = v_fields.supervisor_id,
    supervisor_name = v_fields.supervisor_name,
    head_id = v_fields.head_id,
    head_name = v_fields.head_name,
    site_officer = v_fields.site_officer,
    site_company = v_fields.site_company,
    row_version = row_version + 1,
    updated_at = now()
  where id = p_group_id
  returning * into v_group;

  for v_stop in select value from jsonb_array_elements(v_stops) loop
    v_stop_id := nullif(v_stop ->> 'id', '')::uuid;
    if v_stop_id is null then
      if (select count(*) from public.requests where group_id = p_group_id) >= 20 then
        raise exception 'A request can have at most 20 destinations' using errcode = '22023';
      end if;
      v_kept_ids := v_kept_ids || public.write_request_stop(v_group, null, public.next_stop_letter(p_group_id), v_stop);
      continue;
    end if;
    select * into v_request from public.requests where id = v_stop_id and group_id = p_group_id;
    if v_request.id is null then
      raise exception 'A stop isn''t on this request any more. Reload it and try again' using errcode = 'PT409';
    end if;
    v_kept_ids := v_kept_ids || v_stop_id;
    if v_request.status <> 'ACTIVE'
       or exists (select 1 from public.schedule_requests where request_id = v_stop_id and active) then
      continue;
    end if;
    perform public.write_request_stop(v_group, v_stop_id, v_request.stop_letter, v_stop);
  end loop;

  for v_request in
    select * from public.requests r
    where r.group_id = p_group_id and r.status = 'ACTIVE' and not (r.id = any(v_kept_ids))
  loop
    if exists (select 1 from public.schedule_requests where request_id = v_request.id and active) then
      raise exception 'Stop % is already being scheduled. Ask for its cancellation instead', v_request.stop_letter using errcode = '22023';
    end if;
    perform public.cancel_request_row(v_request.id, v_actor.id);
  end loop;

  if not exists (select 1 from public.requests where group_id = p_group_id and status = 'ACTIVE') then
    raise exception 'Keep at least one destination, or cancel the request instead' using errcode = '22023';
  end if;
  return v_group;
end;
$$;
revoke execute on function update_request_group(uuid, integer, jsonb) from public, anon;
grant execute on function update_request_group(uuid, integer, jsonb) to authenticated;

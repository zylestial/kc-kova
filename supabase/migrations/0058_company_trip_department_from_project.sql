-- A Company Trip's Department / Site is its Project / Site (owner's call,
-- 2026-10-15): the form no longer asks for it separately. All of a Company
-- Trip's stops must have the same Project / Site (a Company Trip takes list
-- choices only, never a typed "Other"), and that project is stored as the
-- group's department_id / department_name, so the printed form and the
-- "one department per trip" rule (0054) work as before. The separate
-- Departments / Sites list is no longer used; groups made before keep the
-- department they printed with. Daily requests are unchanged. Everything
-- else is as in 0052.

create or replace function resolve_group_fields(
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
  v_projects integer;
  v_project_id text;
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
  -- The Department / Site is the one Project / Site all the stops share.
  select count(distinct coalesce(stop ->> 'projectId', '')), max(stop ->> 'projectId')
  into v_projects, v_project_id
  from jsonb_array_elements(coalesce(p_input -> 'stops', '[]'::jsonb)) stop;
  if v_projects > 1 then
    raise exception 'A company trip is for one Project / Site. Pick the same one for every stop' using errcode = '22023';
  end if;
  select * into v_choice from public.resolve_choice('projects', v_project_id, 'Project / Site',
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

-- Personal vehicles (Company trip v2). An employee who can drive company
-- trips may have their own vehicle: the Admin ticks "Has a personal
-- vehicle" on the invite and the employee enters its name and plate when
-- setting up their account. It is a row in Vehicles with its owner, so it
-- prints and books like any other, but:
--   * only its owner can pick it, and only for their own Company trip;
--   * its owner always drives it;
--   * it is never on a Daily trip (it counts as a company trip vehicle,
--     which Daily trips already refuse).

alter table vehicles add column owner_account_id uuid references accounts (id);
alter table vehicles add constraint vehicles_personal_is_company_trip
  check (owner_account_id is null or (company_trips and assigned_driver_id is null));
create unique index vehicles_one_personal_per_owner on vehicles (owner_account_id)
  where owner_account_id is not null;

alter table account_invites add column has_personal_vehicle boolean not null default false;
alter table account_invites add constraint account_invites_personal_vehicle_drives
  check (not has_personal_vehicle or can_drive_company);

-- A trip's vehicle fits its kind; a personal vehicle goes only on its
-- owner's Company trip, driven by its owner.
create or replace function enforce_schedule_kind_vehicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_vehicle public.vehicles;
begin
  select kind into v_kind from public.schedules where id = new.schedule_id;
  select * into v_vehicle from public.vehicles where plate = new.plate;
  if v_kind = 'DAILY' and v_vehicle.company_trips then
    raise exception '% can be requested for company trips, so it isn''t used for Daily trips', new.plate using errcode = '22023';
  end if;
  if v_kind = 'COMPANY' and not coalesce(v_vehicle.company_trips, false) then
    raise exception '% can''t be requested for company trips', new.plate using errcode = '22023';
  end if;
  if v_vehicle.owner_account_id is not null and new.driver_id is distinct from v_vehicle.owner_account_id then
    raise exception '% is a personal vehicle; only its owner drives it', new.plate using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function enforce_schedule_kind_vehicle() from public, anon, authenticated;

-- The vehicle a Company trip request asks for: an active company trip
-- vehicle, and a personal one only for its owner.
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
  if v_vehicle.owner_account_id is not null and v_vehicle.owner_account_id is distinct from auth.uid() then
    raise exception 'That is someone else''s personal vehicle' using errcode = '22023';
  end if;
  return v_vehicle.plate;
end;
$$;

revoke execute on function resolve_request_vehicle(text, text) from public, anon, authenticated;

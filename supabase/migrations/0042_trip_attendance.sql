-- v2.6 trip attendance: the Driver taps Start trip when leaving ANONANG and
-- End trip on returning there. Each tap records server time and, when the
-- phone shares it, the position, its accuracy and how far it is from
-- ANONANG. A tap away from base is kept and flagged, never refused (phone
-- GPS indoors can be off by 50-100 m). This doubles as the Driver's
-- attendance for the day, so submit_completion now needs both taps.
--
-- One row per schedule. The position comes from the Driver's phone and is
-- only as trustworthy as the phone; the time is always the server's.
-- Writes are RPC-only; authenticated gets SELECT only.

create table trip_attendance (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null unique references schedules (id),
  revision_id uuid not null references schedule_revisions (id),
  -- The approved version's Driver, even when an Admin taps for them.
  driver_id uuid not null references accounts (id),
  start_at timestamptz not null default now(),
  start_lat double precision check (start_lat between -90 and 90),
  start_lng double precision check (start_lng between -180 and 180),
  start_accuracy_m double precision check (start_accuracy_m >= 0),
  start_distance_m double precision,
  start_recorded_by_account_id uuid not null references accounts (id),
  end_at timestamptz,
  end_lat double precision check (end_lat between -90 and 90),
  end_lng double precision check (end_lng between -180 and 180),
  end_accuracy_m double precision check (end_accuracy_m >= 0),
  end_distance_m double precision,
  end_recorded_by_account_id uuid references accounts (id),
  check ((start_lat is null) = (start_lng is null)),
  check ((end_lat is null) = (end_lng is null)),
  check ((end_at is null) = (end_recorded_by_account_id is null)),
  check (end_at is null or end_at >= start_at),
  check (end_at is not null or end_lat is null)
);

create index trip_attendance_revision_id_idx on trip_attendance (revision_id);
create index trip_attendance_driver_id_idx on trip_attendance (driver_id);
create index trip_attendance_start_recorded_by_idx on trip_attendance (start_recorded_by_account_id);
create index trip_attendance_end_recorded_by_idx on trip_attendance (end_recorded_by_account_id);

create trigger trip_attendance_audit
  after insert or update or delete on trip_attendance
  for each row execute function write_audit_event();

alter table trip_attendance enable row level security;

grant select on trip_attendance to authenticated;

-- Same as trip_completions: Admin sees all, a Driver sees their own.
create policy trip_attendance_select on trip_attendance for select
  using (
    driver_id = (select auth.uid())
    or (select current_account_role()) = 'Admin'
  );

-- Metres from ANONANG (16.103769, 120.436222), by the haversine formula.
create function distance_from_base_m(p_lat double precision, p_lng double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case when p_lat is null or p_lng is null then null else
    2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat - 16.103769) / 2), 2)
      + cos(radians(16.103769)) * cos(radians(p_lat)) * power(sin(radians(p_lng - 120.436222) / 2), 2)
    ))
  end;
$$;

revoke execute on function distance_from_base_m(double precision, double precision) from public, anon;
grant execute on function distance_from_base_m(double precision, double precision) to authenticated;

-- Records a Start or End tap. p_kind is 'START' or 'END'; the position is
-- optional (null when the phone wouldn't share it). Only the approved
-- version's Driver, or an Admin acting as Driver (flagged as an override),
-- on an active schedule. Start opens from the trip's date (Asia/Manila);
-- End needs Start first. Repeating a tap returns the row unchanged, so the
-- first tap's time stands.
create function record_trip_attendance(
  p_schedule_id uuid,
  p_kind text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null
)
returns public.trip_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_row public.trip_attendance;
  v_is_override boolean := false;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Driver', 'Admin') then
    raise exception 'Driver access required' using errcode = '42501';
  end if;
  if v_actor.role = 'Admin' then
    v_is_override := true;
  end if;

  if p_kind is null or p_kind not in ('START', 'END') then
    raise exception 'Choose Start or End' using errcode = '22023';
  end if;
  if (p_lat is null) <> (p_lng is null)
     or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m < 0 then
    raise exception 'That location isn''t valid' using errcode = '22023';
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_revision from public.schedule_revisions
  where id = v_schedule.published_revision_id and status = 'APPROVED';
  if v_revision is null or (v_revision.driver_id <> v_actor.id and not v_is_override) then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_row from public.trip_attendance where schedule_id = p_schedule_id;
  if found and (p_kind = 'START' or v_row.end_at is not null) then
    return v_row;
  end if;

  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_completions where schedule_id = p_schedule_id) then
    raise exception 'This trip has already been submitted' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'attendance.' || lower(p_kind), true);
  if v_is_override then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;

  if p_kind = 'START' then
    if v_schedule.schedule_date > (now() at time zone 'Asia/Manila')::date then
      raise exception 'This trip can''t be started before its date' using errcode = '22023';
    end if;
    insert into public.trip_attendance (
      schedule_id, revision_id, driver_id,
      start_lat, start_lng, start_accuracy_m, start_distance_m, start_recorded_by_account_id
    ) values (
      p_schedule_id, v_revision.id, v_revision.driver_id,
      p_lat, p_lng, p_accuracy_m, public.distance_from_base_m(p_lat, p_lng), v_actor.id
    )
    returning * into v_row;
  else
    if v_row.id is null then
      raise exception 'Start the trip before ending it' using errcode = '22023';
    end if;
    update public.trip_attendance set
      end_at = now(),
      end_lat = p_lat,
      end_lng = p_lng,
      end_accuracy_m = p_accuracy_m,
      end_distance_m = public.distance_from_base_m(p_lat, p_lng),
      end_recorded_by_account_id = v_actor.id
    where id = v_row.id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke execute on function record_trip_attendance(uuid, text, double precision, double precision, double precision) from public, anon;
grant execute on function record_trip_attendance(uuid, text, double precision, double precision, double precision) to authenticated;

-- submit_completion: same as 0037, plus the trip must have been started and
-- ended (attendance) before its odometers can be submitted. A repeat still
-- returns the existing completion first.
create or replace function submit_completion(
  p_schedule_id uuid,
  p_start_odometer integer,
  p_end_odometer integer,
  p_full_tank boolean default null,
  p_fleet_card_used boolean default null,
  p_gas_receipt_attached boolean default null
)
returns public.trip_completions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_existing public.trip_completions;
  v_trip_end timestamptz;
  v_completion public.trip_completions;
  v_is_override boolean := false;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Driver', 'Admin') then
    raise exception 'Driver access required' using errcode = '42501';
  end if;
  if v_actor.role = 'Admin' then
    v_is_override := true;
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_revision from public.schedule_revisions
  where id = v_schedule.published_revision_id and status = 'APPROVED';
  if v_revision is null or (v_revision.driver_id <> v_actor.id and not v_is_override) then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.trip_completions where schedule_id = p_schedule_id;
  if found then
    return v_existing;
  end if;

  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;

  if p_start_odometer is null or p_end_odometer is null
     or p_start_odometer < 0 or p_end_odometer < p_start_odometer then
    raise exception 'Enter whole-number odometer readings, with the end no lower than the start'
      using errcode = '22023';
  end if;

  select upper(period) into v_trip_end
  from public.schedule_reservations where revision_id = v_revision.id;
  if v_trip_end is null or v_trip_end > now() then
    raise exception 'This trip hasn''t ended yet' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.trip_attendance where schedule_id = p_schedule_id and end_at is not null
  ) then
    raise exception 'Tap Start trip and End trip before submitting' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'completion.submit', true);
  if v_is_override then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;
  insert into public.trip_completions (
    schedule_id, revision_id, driver_id, start_odometer, end_odometer,
    full_tank, fleet_card_used, gas_receipt_attached
  )
  values (
    p_schedule_id, v_revision.id, v_actor.id, p_start_odometer, p_end_odometer,
    p_full_tank, p_fleet_card_used, p_gas_receipt_attached
  )
  returning * into v_completion;

  return v_completion;
end;
$$;

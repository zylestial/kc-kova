-- Stop times: between Start trip and End trip, the Driver taps Arrived on
-- reaching each leg's destination and Leaving on setting off from it. With
-- Start/End (0042) these are the actual times printed on the Daily Vehicle
-- Trip & Utilization Form:
--
--   Leg 1 TIME OUT   = Start trip
--   Leg N TIME IN    = Arrived at leg N's destination
--   Leg N+1 TIME OUT = Leaving leg N's destination
--   Final TIME IN    = End trip
--
-- So the final leg (back to ANONANG) takes no stop taps; End trip is its
-- arrival. Same rules as Start/End: server time, the phone's position when
-- shared, its distance from the destination's saved position (0044) when it
-- has one, and flag-never-block. One row per tap; a repeat returns the
-- first. Writes are RPC-only; authenticated gets SELECT only.

create table stop_taps (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references schedules (id),
  revision_id uuid not null,
  leg_id uuid not null,
  -- The approved version's Driver, even when an Admin taps for them.
  driver_id uuid not null references accounts (id),
  kind text not null check (kind in ('ARRIVE', 'LEAVE')),
  at timestamptz not null default now(),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  accuracy_m double precision check (accuracy_m >= 0),
  -- From the destination's position at tap time; null when either is missing.
  distance_m double precision,
  address text,
  recorded_by_account_id uuid not null references accounts (id),
  unique (leg_id, kind),
  foreign key (leg_id, revision_id) references schedule_legs (id, revision_id),
  check ((lat is null) = (lng is null))
);

create index stop_taps_schedule_id_idx on stop_taps (schedule_id);
create index stop_taps_revision_id_idx on stop_taps (revision_id);
create index stop_taps_leg_id_revision_id_idx on stop_taps (leg_id, revision_id);
create index stop_taps_driver_id_idx on stop_taps (driver_id);
create index stop_taps_recorded_by_idx on stop_taps (recorded_by_account_id);

create trigger stop_taps_audit
  after insert or update or delete on stop_taps
  for each row execute function write_audit_event();

alter table stop_taps enable row level security;

grant select on stop_taps to authenticated;

-- Same as trip_attendance: Admin sees all, a Driver sees their own.
create policy stop_taps_select on stop_taps for select
  using (
    driver_id = (select auth.uid())
    or (select current_account_role()) = 'Admin'
  );

-- Records an Arrived ('ARRIVE') or Leaving ('LEAVE') tap at one leg's
-- destination. Only the approved version's Driver, or an Admin acting as
-- Driver (flagged as an override), on an active schedule, between Start
-- trip and End trip. The leg must be in the approved version and not the
-- final one. Repeating a tap returns the first.
create function record_stop_tap(
  p_schedule_id uuid,
  p_leg_id uuid,
  p_kind text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_address text default null
)
returns public.stop_taps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_leg public.schedule_legs;
  v_destination public.booking_options;
  v_attendance public.trip_attendance;
  v_row public.stop_taps;
  v_is_override boolean := false;
  v_address text := case when p_lat is null then null else nullif(left(trim(p_address), 300), '') end;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Driver', 'Admin') then
    raise exception 'Driver access required' using errcode = '42501';
  end if;
  if v_actor.role = 'Admin' then
    v_is_override := true;
  end if;

  if p_kind is null or p_kind not in ('ARRIVE', 'LEAVE') then
    raise exception 'Choose Arrived or Leaving' using errcode = '22023';
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

  select * into v_leg from public.schedule_legs where id = p_leg_id and revision_id = v_revision.id;
  if v_leg is null then
    raise exception 'That stop isn''t on this trip any more' using errcode = 'P0002';
  end if;
  if v_leg.is_final then
    raise exception 'Tap End trip on returning to ANONANG' using errcode = '22023';
  end if;

  select * into v_row from public.stop_taps where leg_id = p_leg_id and kind = p_kind;
  if found then
    return v_row;
  end if;

  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_completions where schedule_id = p_schedule_id) then
    raise exception 'This trip has already been submitted' using errcode = '22023';
  end if;
  select * into v_attendance from public.trip_attendance where schedule_id = p_schedule_id;
  if v_attendance is null then
    raise exception 'Tap Start trip first' using errcode = '22023';
  end if;
  if v_attendance.end_at is not null then
    raise exception 'This trip has ended' using errcode = '22023';
  end if;

  select * into v_destination from public.booking_options
  where "group" = 'destinations' and id = v_leg.destination_id;

  perform set_config('kova.audit_action', 'stop.' || lower(p_kind), true);
  if v_is_override then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;

  insert into public.stop_taps (
    schedule_id, revision_id, leg_id, driver_id, kind,
    lat, lng, accuracy_m, distance_m, address, recorded_by_account_id
  ) values (
    p_schedule_id, v_revision.id, v_leg.id, v_revision.driver_id, p_kind,
    p_lat, p_lng, p_accuracy_m, public.distance_m(p_lat, p_lng, v_destination.lat, v_destination.lng), v_address, v_actor.id
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function record_stop_tap(uuid, uuid, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function record_stop_tap(uuid, uuid, text, double precision, double precision, double precision, text) to authenticated;

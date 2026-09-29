-- Optional final-return confirmations on trip_completions: full tank,
-- fleet card used, gas receipt attached. Mirrors the paper form's "FINAL
-- RETURN / FULL-TANK CONFIRMATION" section, which today is left as blank
-- checkboxes for handwriting (see app/finished-trip-print.tsx). Nullable and
-- optional by design -- unlike the odometer pair, the Driver is never
-- required to answer these to submit_completion; null means "not answered",
-- distinct from an explicit false.

alter table trip_completions
  add column full_tank boolean,
  add column fleet_card_used boolean,
  add column gas_receipt_attached boolean;

drop function submit_completion(uuid, integer, integer);

-- Same as the 0034 admin-override version, plus the three optional
-- return-confirmation params.
create function submit_completion(
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

revoke execute on function submit_completion(uuid, integer, integer, boolean, boolean, boolean) from public, anon;
grant execute on function submit_completion(uuid, integer, integer, boolean, boolean, boolean) to authenticated;

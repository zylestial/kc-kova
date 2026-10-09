-- Stop times: a Driver back at ANONANG can complete the trip right away.
-- Tapping End trip there is the proof the trip ended, so submit_completion
-- no longer also waits for the last planned Time In (a trip that finishes
-- early would otherwise sit until the scheduled time). Same as 0042
-- otherwise: End trip is still required, and a repeat still returns the
-- existing completion first.

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

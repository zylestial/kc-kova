-- v2.0 Driver completion RPCs: submit_completion, report_problem.
--
--   submit_completion   The Driver of a schedule's approved version records
--                       one odometer pair for the whole schedule, once the
--                       trip's last planned Time In has passed. Pins the
--                       approved version; submitted_at is server time.
--                       Repeating returns the existing completion.
--   report_problem      The same Driver leaves a note on the approved
--                       version. Needs no odometers, doesn't complete or
--                       block anything, and can be filed more than once.
--
-- Correcting or marking a completion Done, and handling problem reports, are
-- Admin finished-record rules (Phase 9). Both RPCs lock the schedule row
-- first, so they serialize against approval and cancellation.

create function submit_completion(
  p_schedule_id uuid,
  p_start_odometer integer,
  p_end_odometer integer
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
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Driver' then
    raise exception 'Driver access required' using errcode = '42501';
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_revision from public.schedule_revisions
  where id = v_schedule.published_revision_id and status = 'APPROVED';
  if v_revision is null or v_revision.driver_id <> v_actor.id then
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
  insert into public.trip_completions (schedule_id, revision_id, driver_id, start_odometer, end_odometer)
  values (p_schedule_id, v_revision.id, v_actor.id, p_start_odometer, p_end_odometer)
  returning * into v_completion;

  return v_completion;
end;
$$;

create function report_problem(p_schedule_id uuid, p_note text)
returns public.problem_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_report public.problem_reports;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Driver' then
    raise exception 'Driver access required' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Describe the problem' using errcode = '22023';
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_revision from public.schedule_revisions
  where id = v_schedule.published_revision_id and status = 'APPROVED';
  if v_revision is null or v_revision.driver_id <> v_actor.id then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'problem.report', true);
  insert into public.problem_reports (schedule_id, revision_id, driver_id, note)
  values (p_schedule_id, v_revision.id, v_actor.id, trim(p_note))
  returning * into v_report;

  return v_report;
end;
$$;

revoke execute on function submit_completion(uuid, integer, integer) from public, anon;
grant execute on function submit_completion(uuid, integer, integer) to authenticated;
revoke execute on function report_problem(uuid, text) from public, anon;
grant execute on function report_problem(uuid, text) to authenticated;

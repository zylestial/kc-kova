-- v2.0 Admin finished-trip RPCs: correct_completion, mark_completion_done,
-- handle_problem.
--
--   correct_completion     Admin changes the odometer pair of a SUBMITTED
--                          completion. A DONE completion can't be changed.
--   mark_completion_done   Admin marks a SUBMITTED completion DONE. From then
--                          on the done-lock trigger blocks any change.
--                          Repeating returns the existing DONE completion.
--   handle_problem         Admin marks a problem report HANDLED with a
--                          handling note and, optionally, a follow-up
--                          schedule. Repeating returns the handled report.
--
-- Every RPC locks the schedule row first, so they serialize against the
-- Driver's submit_completion and against cancellation.

create function correct_completion(
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
  v_completion public.trip_completions;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  perform 1 from public.schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_completion from public.trip_completions where schedule_id = p_schedule_id;
  if not found then
    raise exception 'This trip has no completion to correct' using errcode = 'P0002';
  end if;
  if v_completion.status = 'DONE' then
    raise exception 'This trip is marked as done and is locked' using errcode = '22023';
  end if;

  if p_start_odometer is null or p_end_odometer is null
     or p_start_odometer < 0 or p_end_odometer < p_start_odometer then
    raise exception 'Enter whole-number odometer readings, with the end no lower than the start'
      using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'completion.correct', true);
  update public.trip_completions
  set start_odometer = p_start_odometer, end_odometer = p_end_odometer
  where id = v_completion.id
  returning * into v_completion;

  return v_completion;
end;
$$;

create function mark_completion_done(p_schedule_id uuid)
returns public.trip_completions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_completion public.trip_completions;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  perform 1 from public.schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_completion from public.trip_completions where schedule_id = p_schedule_id;
  if not found then
    raise exception 'This trip has no completion to mark as done' using errcode = 'P0002';
  end if;
  if v_completion.status = 'DONE' then
    return v_completion;
  end if;

  perform set_config('kova.audit_action', 'completion.done', true);
  update public.trip_completions
  set status = 'DONE', done_at = now(), done_by_account_id = v_actor.id
  where id = v_completion.id
  returning * into v_completion;

  return v_completion;
end;
$$;

create function handle_problem(
  p_problem_id uuid,
  p_handling_note text,
  p_follow_up_schedule_id uuid default null
)
returns public.problem_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_report public.problem_reports;
  v_follow_up public.schedules;
  v_schedule_id uuid;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select schedule_id into v_schedule_id from public.problem_reports where id = p_problem_id;
  if not found then
    raise exception 'Problem report not found' using errcode = 'P0002';
  end if;

  perform 1 from public.schedules where id = v_schedule_id for update;

  select * into v_report from public.problem_reports where id = p_problem_id for update;
  if v_report.status = 'HANDLED' then
    return v_report;
  end if;

  if coalesce(trim(p_handling_note), '') = '' then
    raise exception 'Describe how the problem was handled' using errcode = '22023';
  end if;

  if p_follow_up_schedule_id is not null then
    select * into v_follow_up from public.schedules where id = p_follow_up_schedule_id;
    if not found then
      raise exception 'Follow-up schedule not found' using errcode = 'P0002';
    end if;
    if v_follow_up.id = v_report.schedule_id or v_follow_up.status <> 'ACTIVE' then
      raise exception 'Choose a different, active schedule as the follow-up' using errcode = '22023';
    end if;
  end if;

  perform set_config('kova.audit_action', 'problem.handle', true);
  update public.problem_reports
  set status = 'HANDLED',
      handled_at = now(),
      handled_by_account_id = v_actor.id,
      handling_note = trim(p_handling_note),
      follow_up_schedule_id = p_follow_up_schedule_id
  where id = p_problem_id
  returning * into v_report;

  return v_report;
end;
$$;

revoke execute on function correct_completion(uuid, integer, integer) from public, anon;
grant execute on function correct_completion(uuid, integer, integer) to authenticated;
revoke execute on function mark_completion_done(uuid) from public, anon;
grant execute on function mark_completion_done(uuid) to authenticated;
revoke execute on function handle_problem(uuid, text, uuid) from public, anon;
grant execute on function handle_problem(uuid, text, uuid) to authenticated;

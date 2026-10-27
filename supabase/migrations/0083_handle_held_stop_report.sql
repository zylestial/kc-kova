-- A stop report can't be marked handled while it holds the trip (2026-10-27).
-- Found in a QA pass: Finished Trips offered Mark handled on every open
-- report, stop reports included. On one still waiting for its answer
-- (0068), handle_problem closed the report but left schedules.paused_at set,
-- so the Driver stayed held with no Arrived / Leaving, Scheduling no longer
-- listed the report, and nobody could answer it: only End trip got the
-- Driver going again, with the stops left counted as not reached.
--
-- handle_problem: same as 0063, except it refuses a stop report that is
-- holding the trip (unanswered, or waiting on a route change). Answered
-- reports, reports from before 0068, and whole-trip problems are unchanged.

create or replace function handle_problem(
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
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Admin', 'Scheduler') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select schedule_id into v_schedule_id from public.problem_reports where id = p_problem_id;
  if not found then
    raise exception 'Problem report not found' using errcode = 'P0002';
  end if;

  perform 1 from public.schedules where id = v_schedule_id for update;

  select * into v_report from public.problem_reports where id = p_problem_id for update;
  -- A Scheduler handles stop reports (0061), not whole-trip problems.
  if v_actor.role = 'Scheduler' and v_report.leg_id is null then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if v_report.status = 'HANDLED' then
    return v_report;
  end if;

  -- A stop report still holding the trip closes with its answer on
  -- Scheduling (0068), which also lifts the hold and tells the Driver;
  -- marking it handled here would leave the trip held with nothing to answer.
  if v_report.leg_id is not null and v_report.kind <> 'NOT_REACHED'
    and coalesce(v_report.decision, 'CHANGE') = 'CHANGE'
    and exists (select 1 from public.schedules where id = v_report.schedule_id and paused_at is not null) then
    raise exception 'Answer this report on Scheduling first: the trip is held until it''s answered' using errcode = '22023';
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


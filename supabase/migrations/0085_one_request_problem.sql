-- One request at a shared stop has a problem (owner's call, 2026-11-03).
-- Skipping some of the requests at a stop told the Driver to skip the whole
-- place, though the others there still have to be done. And only Not available
-- or Wrong address could name some of the requests, so anything else counted
-- against all of them.
--
-- report_stop: same as 0068, except Other can name some of the requests too.
-- answer_stop_report: same as 0068, except the message when Skip is for some
--   of the requests at the stop.
-- report_unreached_stops: same as 0068, except a report on a stop already
--   reached no longer ends with the trip. Tapping Arrived, reporting, then
--   End trip (unanswered, or answered End the trip) left its requests on the
--   ended trip, looking served, with nothing to plan them again or move them.
--   It now counts as Skip, so the Scheduler gets Plan again, Another day and
--   Send back. A stop not reached is still covered by its NOT_REACHED report.

create or replace function report_stop(
  p_schedule_id uuid,
  p_leg_id uuid,
  p_kind text,
  p_note text default '',
  p_skip boolean default false,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_request_ids uuid[] default null
)
returns public.problem_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_revision public.schedule_revisions;
  v_schedule public.schedules;
  v_leg public.schedule_legs;
  v_missed boolean;
  v_note text := coalesce(trim(p_note), '');
  v_report public.problem_reports;
  v_label text;
  v_at_stop uuid[];
  v_partial boolean := false;
  v_which text;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  v_revision := public.trip_for_reporting(p_schedule_id, v_actor);
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if p_kind is null or p_kind not in ('NOT_AVAILABLE', 'WRONG_ADDRESS', 'ROAD_BLOCKED', 'VEHICLE_PROBLEM', 'OTHER') then
    raise exception 'Choose what happened' using errcode = '22023';
  end if;
  perform public.check_tap_location(p_lat, p_lng, p_accuracy_m);

  select * into v_leg from public.schedule_legs where id = p_leg_id and revision_id = v_revision.id;
  if v_leg.id is null then
    raise exception 'That stop isn''t on this trip any more' using errcode = 'P0002';
  end if;
  if v_leg.is_final then
    raise exception 'Report the way back to ANONANG as a problem with the trip' using errcode = '22023';
  end if;

  -- Some of the requests at this stop, not all: the stop is still reached.
  select coalesce(array_agg(distinct rd.request_id), '{}') into v_at_stop
  from public.leg_stops ls
  join public.request_destinations rd on rd.id = ls.request_destination_id
  where ls.leg_id = v_leg.id and ls.revision_id = v_revision.id;
  if p_request_ids is not null and cardinality(p_request_ids) > 0 then
    if not (p_request_ids <@ v_at_stop) then
      raise exception 'Choose stops at this place' using errcode = '22023';
    end if;
    v_partial := not (v_at_stop <@ p_request_ids);
    if v_partial and p_kind not in ('NOT_AVAILABLE', 'WRONG_ADDRESS', 'OTHER') then
      raise exception 'Only Not available, Wrong address or Something else can be for some of the stops here' using errcode = '22023';
    end if;
  end if;

  -- The Scheduler decides whether it's missed (answer_stop_report); p_skip is no longer used.
  v_missed := false;
  if public.leg_missed(v_leg.id) then
    raise exception 'This stop was already reported missed' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'problem.report_stop', true);
  insert into public.problem_reports (
    schedule_id, revision_id, driver_id, note, leg_id, kind, missed, reported_by_account_id, lat, lng, accuracy_m, request_ids
  ) values (
    p_schedule_id, v_revision.id, v_revision.driver_id, left(v_note, 500), v_leg.id, p_kind, v_missed, v_actor.id,
    p_lat, p_lng, p_accuracy_m, case when v_partial then p_request_ids end
  ) returning * into v_report;

  -- Every report holds the trip until it's answered.
  perform public.refresh_trip_hold(p_schedule_id);

  v_label := public.stop_report_label(p_kind);
  if v_partial then
    select string_agg(coalesce(g.number || '-' || r.stop_letter, r.owner_name), ', ' order by g.number, r.stop_letter)
    into v_which
    from public.requests r
    left join public.request_groups g on g.id = r.group_id
    where r.id = any(p_request_ids);
    v_label := format('%s for %s', v_label, v_which);
  end if;
  perform public.notify_schedulers(
    'STOP_REPORTED',
    format('%s at %s: %s''s trip on %s. Waiting for your answer', v_label, v_leg.destination_name, v_revision.plate, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null, p_schedule_id
  );
  perform public.notify_admins(
    'STOP_REPORTED',
    format('%s at %s: %s''s trip on %s. Waiting for your answer', v_label, v_leg.destination_name, v_revision.plate, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null, p_schedule_id
  );

  return v_report;
end;
$$;

create or replace function answer_stop_report(p_problem_id uuid, p_decision text)
returns public.problem_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_report public.problem_reports;
  v_schedule public.schedules;
  v_leg public.schedule_legs;
  v_has_stops boolean;
  v_label text;
  v_message text;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Only a Scheduler or Admin answers a stop report' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('SKIP', 'WAIT', 'END', 'CHANGE') then
    raise exception 'Choose an answer' using errcode = '22023';
  end if;

  select * into v_schedule from public.schedules
  where id = (select schedule_id from public.problem_reports where id = p_problem_id)
  for update;
  select * into v_report from public.problem_reports where id = p_problem_id for update;
  if v_report.id is null or v_report.leg_id is null then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  -- Unanswered, or waiting on a route change, which another answer can replace.
  if v_report.kind = 'NOT_REACHED' or v_report.status <> 'OPEN' or coalesce(v_report.decision, 'CHANGE') <> 'CHANGE' then
    raise exception 'This report was already answered. Reload and try again' using errcode = '22023';
  end if;
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This trip is no longer active' using errcode = '22023';
  end if;
  select * into v_leg from public.schedule_legs where id = v_report.leg_id;
  v_label := public.stop_report_label(v_report.kind);

  perform set_config('kova.audit_action', 'problem.answer', true);
  perform set_config('kova.audit_is_override', (v_actor.role = 'Admin')::text, true);

  if p_decision = 'SKIP' then
    if v_report.request_ids is null and public.leg_missed(v_report.leg_id) then
      raise exception 'This stop was already reported missed' using errcode = '22023';
    end if;
    v_has_stops := exists (
      select 1 from public.leg_stops ls
      join public.request_destinations rd on rd.id = ls.request_destination_id
      where ls.leg_id = v_report.leg_id and ls.revision_id = v_schedule.published_revision_id
        and (v_report.request_ids is null or rd.request_id = any(v_report.request_ids))
    );
    -- Missed: the whole stop, or just the requests the report names (0067).
    -- With requests, it stays open for the Scheduler to plan them again.
    update public.problem_reports set
      missed = v_report.request_ids is null,
      status = case when v_has_stops then 'OPEN' else 'HANDLED' end,
      handled_at = case when v_has_stops then null else now() end,
      handled_by_account_id = case when v_has_stops then null else v_actor.id end,
      handling_note = case when v_has_stops then '' else 'Skipped' end
    where id = p_problem_id;
    if v_has_stops then
      perform public.notify_stop_missed(v_leg, v_label, v_report.reported_by_account_id, v_report.request_ids);
    end if;
    v_message := case when v_report.request_ids is null
      then format('Skip %s and go on to the next stop', v_leg.destination_name)
      else format('Skip only what you reported. Do the others at %s, then go on', v_leg.destination_name) end;
  elsif p_decision = 'WAIT' then
    update public.problem_reports set status = 'HANDLED', handled_at = now(), handled_by_account_id = v_actor.id,
      handling_note = 'Told to wait'
    where id = p_problem_id;
    v_message := case when v_report.kind = 'VEHICLE_PROBLEM'
      then 'Go on once the vehicle is fixed'
      else format('Stay at %s and go on when it''s ready', v_leg.destination_name) end;
  elsif p_decision = 'END' then
    update public.problem_reports set status = 'HANDLED', handled_at = now(), handled_by_account_id = v_actor.id,
      handling_note = 'Told to end the trip'
    where id = p_problem_id;
    v_message := 'End the trip: tap End trip now and head back';
  else
    v_message := 'Your route is being changed. Wait until it shows here';
  end if;

  update public.problem_reports set decision = p_decision, decided_at = now(), decided_by_account_id = v_actor.id
  where id = p_problem_id
  returning * into v_report;
  perform public.refresh_trip_hold(v_schedule.id);

  if v_report.reported_by_account_id is not null and v_report.reported_by_account_id <> v_actor.id then
    perform public.notify(
      v_report.reported_by_account_id, 'STOP_ANSWERED',
      format('%s at %s: %s', v_label, coalesce(v_leg.destination_name, 'a stop'), v_message),
      null, v_schedule.id
    );
  end if;
  return v_report;
end;
$$;

create or replace function report_unreached_stops()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_last int;
  v_leg public.schedule_legs;
  v_report public.problem_reports;
  v_covered uuid[];
  v_left uuid[];
  v_whole boolean;
  v_has_stops boolean;
  v_places text[] := '{}';
  v_to_plan text[] := '{}';
  v_action text := current_setting('kova.audit_action', true);
begin
  if old.end_at is not null or new.end_at is null then
    return new;
  end if;
  select * into v_schedule from public.schedules where id = new.schedule_id;
  update public.schedules set paused_at = null where id = new.schedule_id;
  select * into v_revision from public.schedule_revisions where id = v_schedule.published_revision_id;
  if v_revision.id is not null then
    -- The last leg reached: tapped, or reported missed.
    select coalesce(max(l.leg_no), 0) into v_last
    from public.schedule_legs l
    where l.revision_id = v_revision.id
      and (exists (select 1 from public.stop_taps t where t.leg_id = l.id) or public.leg_missed(l.id));

    perform set_config('kova.audit_action', 'problem.not_reached', true);

    -- A report on a stop reached, not answered or answered End the trip: as if
    -- answered Skip. Nobody chose it, so it has no decided_by_account_id.
    for v_report in
      select p.* from public.problem_reports p
      join public.schedule_legs l on l.id = p.leg_id and l.revision_id = v_revision.id
      where p.schedule_id = new.schedule_id and l.leg_no <= v_last and p.kind <> 'NOT_REACHED'
        and (p.decision = 'END' or (p.status = 'OPEN' and (p.decision is null or p.decision = 'CHANGE')))
      order by p.created_at
    loop
      select * into v_leg from public.schedule_legs where id = v_report.leg_id;
      -- Requests another report here already covers aren't planned twice.
      select coalesce(array_agg(distinct ids.id), '{}') into v_covered
      from public.problem_reports p, unnest(p.request_ids) as ids (id)
      where p.leg_id = v_leg.id and p.status = 'OPEN' and p.decision = 'SKIP';
      select coalesce(array_agg(distinct rd.request_id), '{}') into v_left
      from public.leg_stops ls
      join public.request_destinations rd on rd.id = ls.request_destination_id
      where ls.leg_id = v_leg.id and ls.revision_id = v_revision.id
        and (v_report.request_ids is null or rd.request_id = any(v_report.request_ids))
        and not (rd.request_id = any(v_covered));

      if cardinality(v_left) = 0 or public.leg_missed(v_leg.id) then
        -- Answered End the trip keeps its own closing note.
        if v_report.status = 'OPEN' then
          update public.problem_reports set status = 'HANDLED', handled_at = now(), handling_note = 'The trip ended'
          where id = v_report.id;
        end if;
        continue;
      end if;

      v_whole := v_report.request_ids is null and cardinality(v_covered) = 0;
      update public.problem_reports set
        decision = 'SKIP',
        decided_at = now(),
        decided_by_account_id = null,
        missed = v_whole,
        request_ids = case when v_whole then null else v_left end,
        status = 'OPEN',
        handled_at = null,
        handled_by_account_id = null,
        handling_note = ''
      where id = v_report.id;
      v_to_plan := v_to_plan || v_leg.destination_name;
      perform public.notify_stop_missed(v_leg, public.stop_report_label(v_report.kind), new.end_recorded_by_account_id, v_left);
    end loop;
  end if;

  -- Any other report still waiting ends with the trip.
  update public.problem_reports set status = 'HANDLED', handled_at = now(), handling_note = 'The trip ended'
  where schedule_id = new.schedule_id and leg_id is not null and status = 'OPEN' and (decision is null or decision = 'CHANGE');
  if v_revision.id is null then
    return new;
  end if;

  for v_leg in
    select * from public.schedule_legs
    where revision_id = v_revision.id and not is_final and leg_no > v_last and not public.leg_missed(id)
    order by leg_no
  loop
    v_has_stops := exists (select 1 from public.leg_stops where leg_id = v_leg.id and revision_id = v_revision.id);
    insert into public.problem_reports (
      schedule_id, revision_id, driver_id, note, leg_id, kind, missed, reported_by_account_id,
      status, handled_at, handling_note
    ) values (
      v_schedule.id, v_revision.id, v_revision.driver_id, 'The trip ended before this stop', v_leg.id, 'NOT_REACHED', true,
      new.end_recorded_by_account_id,
      case when v_has_stops then 'OPEN' else 'HANDLED' end,
      case when v_has_stops then null else now() end,
      case when v_has_stops then '' else 'Nothing to plan again' end
    );
    v_places := v_places || v_leg.destination_name;
    if v_has_stops then
      perform public.notify_stop_missed(v_leg, 'not reached, the trip ended early', new.end_recorded_by_account_id);
    end if;
  end loop;
  perform set_config('kova.audit_action', coalesce(v_action, ''), true);

  if cardinality(v_places) > 0 then
    perform public.notify_schedulers(
      'STOP_REPORTED',
      format('Trip ended before %s: %s''s trip on %s', array_to_string(v_places, ', '), v_revision.plate,
        to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      null, v_schedule.id
    );
    perform public.notify_admins(
      'STOP_REPORTED',
      format('Trip ended before %s: %s''s trip on %s', array_to_string(v_places, ', '), v_revision.plate,
        to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      null, v_schedule.id
    );
  end if;
  if cardinality(v_to_plan) > 0 then
    perform public.notify_schedulers(
      'STOP_REPORTED',
      format('Trip ended with requests to plan again at %s: %s''s trip on %s', array_to_string(v_to_plan, ', '), v_revision.plate,
        to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      null, v_schedule.id
    );
    perform public.notify_admins(
      'STOP_REPORTED',
      format('Trip ended with requests to plan again at %s: %s''s trip on %s', array_to_string(v_to_plan, ', '), v_revision.plate,
        to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      null, v_schedule.id
    );
  end if;
  return new;
end;
$$;

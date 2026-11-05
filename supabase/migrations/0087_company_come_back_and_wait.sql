-- Two gaps left by 0085 and 0086 (owner's request, 2026-11-03).
--
-- Come back later on a Company trip. It was left to Daily trips until it was
-- tested on one: a Company trip has the same legs, with the last stop its end.
-- come_back_later: same as 0086, without refusing a Company trip.
--
-- Wait there, then the trip ends. The Scheduler answered Wait there, the Driver
-- still couldn't get it and tapped End trip now without Leaving. The stop counted
-- as reached, so its requests stayed on the ended trip looking served.
-- report_unreached_stops: same as 0085, plus a report answered Wait there on the
-- last stop reached, if its Leaving was never tapped. Got it, it was done clears
-- it if the job was done and only the tap was forgotten.

create or replace function come_back_later(p_problem_id uuid, p_after_leg_id uuid)
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
  v_after public.schedule_legs;
  v_next public.schedule_legs;
  v_new_leg uuid;
  v_last int;
  v_covered uuid[];
  v_destinations uuid[];
  v_whole boolean;
  v_out time(0);
  v_in time(0);
  v_shift interval := interval '0';
  v_first_out time(0);
  v_last_in time(0);
  v_message text;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Only a Scheduler or Admin answers a stop report' using errcode = '42501';
  end if;

  select * into v_schedule from public.schedules
  where id = (select schedule_id from public.problem_reports where id = p_problem_id)
  for update;
  select * into v_report from public.problem_reports where id = p_problem_id for update;
  if v_report.id is null or v_report.leg_id is null then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if v_report.kind in ('NOT_REACHED', 'VEHICLE_PROBLEM') or v_report.status <> 'OPEN' or coalesce(v_report.decision, 'CHANGE') <> 'CHANGE' then
    raise exception 'This report can''t be answered that way any more. Reload and try again' using errcode = '22023';
  end if;
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This trip is no longer active' using errcode = '22023';
  end if;
  -- Approving draft changes rewrites the route, which would lose the new stop.
  if exists (
    select 1 from public.schedule_revisions
    where schedule_id = v_schedule.id and status in ('DRAFT', 'SUBMITTED', 'RETURNED')
  ) then
    raise exception 'This trip has route changes waiting. Finish or discard them first' using errcode = '22023';
  end if;

  select * into v_leg from public.schedule_legs where id = v_report.leg_id and revision_id = v_schedule.published_revision_id;
  select * into v_after from public.schedule_legs where id = p_after_leg_id and revision_id = v_schedule.published_revision_id;
  if v_leg.id is null or v_after.id is null then
    raise exception 'That stop isn''t on this trip any more. Reload and try again' using errcode = '22023';
  end if;
  select coalesce(max(l.leg_no), 0) into v_last
  from public.schedule_legs l
  where l.revision_id = v_schedule.published_revision_id
    and (exists (select 1 from public.stop_taps t where t.leg_id = l.id) or public.leg_missed(l.id));
  if v_after.is_final or v_after.leg_no <= v_leg.leg_no or v_after.leg_no < v_last then
    raise exception 'Choose a stop still ahead on this trip' using errcode = '22023';
  end if;
  if (select count(*) from public.schedule_legs where revision_id = v_schedule.published_revision_id) >= 8 then
    raise exception 'This trip already has 8 legs, so it can''t take another stop' using errcode = '22023';
  end if;

  -- Requests another report here already skipped stay out of it.
  select coalesce(array_agg(distinct ids.id), '{}') into v_covered
  from public.problem_reports p, unnest(p.request_ids) as ids (id)
  where p.leg_id = v_leg.id and p.status = 'OPEN' and p.decision = 'SKIP';
  select array_agg(ls.request_destination_id) into v_destinations
  from public.leg_stops ls
  join public.request_destinations rd on rd.id = ls.request_destination_id
  where ls.leg_id = v_leg.id and ls.revision_id = v_schedule.published_revision_id
    and (v_report.request_ids is null or rd.request_id = any(v_report.request_ids))
    and not (rd.request_id = any(v_covered));
  if v_destinations is null then
    raise exception 'This stop has no requests left to come back for. Reload and try again' using errcode = '22023';
  end if;
  v_whole := not exists (
    select 1 from public.leg_stops ls
    where ls.leg_id = v_leg.id and ls.revision_id = v_schedule.published_revision_id
      and not (ls.request_destination_id = any(v_destinations))
  );

  -- 30 minutes straight after the stop picked; the rest only move if they must.
  v_out := v_after.planned_time_in;
  if extract(epoch from v_out) + 1800 >= 86400 then
    raise exception 'There''s no planned time left today after that stop' using errcode = '22023';
  end if;
  v_in := v_out + interval '30 minutes';
  select * into v_next from public.schedule_legs
  where revision_id = v_schedule.published_revision_id and leg_no = v_after.leg_no + 1;
  if v_next.id is not null and v_in > v_next.planned_time_out then
    v_shift := v_in - v_next.planned_time_out;
  end if;
  if exists (
    select 1 from public.schedule_legs
    where revision_id = v_schedule.published_revision_id and leg_no > v_after.leg_no
      and extract(epoch from planned_time_in) + extract(epoch from v_shift) >= 86400
  ) then
    raise exception 'There''s no planned time left today after that stop' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'problem.come_back_later', true);
  perform set_config('kova.audit_is_override', (v_actor.role = 'Admin')::text, true);
  perform set_config('kova.live_edit_revision', v_schedule.published_revision_id::text, true);
  update public.schedule_legs set leg_no = leg_no + 100
  where revision_id = v_schedule.published_revision_id and leg_no > v_after.leg_no;
  update public.schedule_legs set
    leg_no = leg_no - 99,
    planned_time_out = planned_time_out + v_shift,
    planned_time_in = planned_time_in + v_shift,
    origin = case when leg_no - 100 = v_after.leg_no + 1 then v_leg.destination_name else origin end
  where revision_id = v_schedule.published_revision_id and leg_no > 100;
  insert into public.schedule_legs (
    revision_id, leg_no, origin, destination_id, destination_name,
    planned_time_out, planned_time_in, contact_name, contact_number, is_final
  ) values (
    v_schedule.published_revision_id, v_after.leg_no + 1, v_after.destination_name, v_leg.destination_id, v_leg.destination_name,
    v_out, v_in, v_leg.contact_name, v_leg.contact_number, false
  ) returning id into v_new_leg;
  delete from public.leg_stops
  where revision_id = v_schedule.published_revision_id and request_destination_id = any(v_destinations);
  insert into public.leg_stops (leg_id, revision_id, request_destination_id)
  select v_new_leg, v_schedule.published_revision_id, unnest(v_destinations);
  perform set_config('kova.live_edit_revision', '', true);

  select min(planned_time_out), max(planned_time_in) into v_first_out, v_last_in
  from public.schedule_legs where revision_id = v_schedule.published_revision_id;
  update public.schedule_reservations set period = tstzrange(
    (v_schedule.schedule_date + v_first_out) at time zone 'Asia/Manila',
    (v_schedule.schedule_date + v_last_in) at time zone 'Asia/Manila',
    '[)'
  ) where revision_id = v_schedule.published_revision_id;
  update public.schedule_revisions set row_version = row_version + 1, updated_at = now() where id = v_schedule.published_revision_id;
  update public.schedules set updated_at = now() where id = v_schedule.id;

  update public.problem_reports set
    missed = v_whole,
    decision = 'LATER',
    decided_at = now(),
    decided_by_account_id = v_actor.id,
    status = 'HANDLED',
    handled_at = now(),
    handled_by_account_id = v_actor.id,
    handling_note = 'Coming back later'
  where id = p_problem_id
  returning * into v_report;
  perform public.refresh_trip_hold(v_schedule.id);

  v_message := case when v_whole
    then format('Go on to the next stop. Come back to %s after %s', v_leg.destination_name, v_after.destination_name)
    else format('Do the others at %s, then go on. Come back after %s for the rest', v_leg.destination_name, v_after.destination_name) end;
  if v_report.reported_by_account_id is not null and v_report.reported_by_account_id <> v_actor.id then
    perform public.notify(
      v_report.reported_by_account_id, 'STOP_ANSWERED',
      format('%s at %s: %s', public.stop_report_label(v_report.kind), v_leg.destination_name, v_message),
      null, v_schedule.id
    );
  end if;
  return v_report;
exception
  when exclusion_violation then
    raise exception 'That would run into this Driver''s or vehicle''s next trip. Choose another answer' using errcode = '23P01';
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

    -- A report on a stop reached, not answered or answered End the trip, or
    -- answered Wait there on the last stop reached and never left: as if answered
    -- Skip. Nobody chose it, so it has no decided_by_account_id.
    for v_report in
      select p.* from public.problem_reports p
      join public.schedule_legs l on l.id = p.leg_id and l.revision_id = v_revision.id
      where p.schedule_id = new.schedule_id and l.leg_no <= v_last and p.kind <> 'NOT_REACHED'
        and (p.decision = 'END' or (p.status = 'OPEN' and (p.decision is null or p.decision = 'CHANGE'))
          or (p.decision = 'WAIT' and l.leg_no = v_last
            and not exists (select 1 from public.stop_taps t where t.leg_id = l.id and t.kind = 'LEAVE')))
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
        -- Answered End the trip or Wait there keeps its own closing note.
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

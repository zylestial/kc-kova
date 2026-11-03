-- Come back later (owner's request, 2026-11-03). At Wilcon the order is placed
-- but not paid yet, so the Driver should go on and pick it up later instead of
-- waiting. Skip said "missed" and took it off the trip, and putting it back
-- needed a route change and the Admin. Now a Scheduler answers with one tap:
-- the requests move to a new stop at the same place, after the stop they pick.
-- It's the same trip and places, so it needs no Admin, and nobody is told it
-- was missed. If all the requests there move, the first visit stays on the
-- route and the printed form with no stops, marked missed as in 0063: it needs
-- no Leaving, and the rest of the app already handles such a stop.
--
-- report_stop: same as 0085, plus the kind NOT_READY, which can name some of
--   the requests at a stop.
-- come_back_later: new, for Daily trips only so far.
-- The new stop's planned times are made up: 30 minutes straight after the stop
-- picked, later stops pushed back only as far as needed. Taps record the real ones.

alter table problem_reports drop constraint problem_reports_kind_check;
alter table problem_reports add constraint problem_reports_kind_check
  check (kind in ('NOT_AVAILABLE', 'NOT_READY', 'WRONG_ADDRESS', 'ROAD_BLOCKED', 'VEHICLE_PROBLEM', 'OTHER', 'NOT_REACHED'));
alter table problem_reports drop constraint problem_reports_decision_check;
alter table problem_reports add constraint problem_reports_decision_check
  check (decision in ('SKIP', 'WAIT', 'END', 'CHANGE', 'LATER'));

create or replace function stop_report_label(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'NOT_AVAILABLE' then 'Not available'
    when 'NOT_READY' then 'Not ready yet'
    when 'WRONG_ADDRESS' then 'Wrong address or closed'
    when 'ROAD_BLOCKED' then 'Road blocked or bad weather'
    when 'VEHICLE_PROBLEM' then 'Vehicle problem'
    when 'NOT_REACHED' then 'Not reached'
    else 'Problem' end;
$$;

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
  if p_kind is null or p_kind not in ('NOT_AVAILABLE', 'NOT_READY', 'WRONG_ADDRESS', 'ROAD_BLOCKED', 'VEHICLE_PROBLEM', 'OTHER') then
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
    if v_partial and p_kind not in ('NOT_AVAILABLE', 'NOT_READY', 'WRONG_ADDRESS', 'OTHER') then
      raise exception 'Only Not available, Not ready, Wrong address or Something else can be for some of the stops here' using errcode = '22023';
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

create function come_back_later(p_problem_id uuid, p_after_leg_id uuid)
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
  if v_schedule.kind = 'COMPANY' then
    raise exception 'A Company trip can''t come back to a stop yet. Choose another answer' using errcode = '22023';
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

revoke execute on function come_back_later(uuid, uuid) from public, anon;
grant execute on function come_back_later(uuid, uuid) to authenticated;

-- Stops not reached, and telling the requester (owner's request, 2026-10-16).
--
-- A trip ended early ("End trip now", or End trip with stops left) counted
-- its unreached stops as served: nobody was told, the requests were never
-- planned again, and the Admin couldn't mark the trip Done without making
-- up their times. Now End trip reports every non-final leg after the last
-- one reached (tapped, or reported missed) as missed, kind NOT_REACHED. A
-- leg with requests shows on Scheduling like any missed stop (0063, 0065);
-- a fuel / errand stop is handled at once, as there's nothing to plan.
-- Schedulers and Admins get one STOP_REPORTED for the trip.
--
-- The requester is told when their stop is missed (STOP_MISSED), by
-- report_stop or by End trip, unless they reported it themselves (a
-- Company trip's requester).
--
-- report_stop: same as 0061, except it tells the requesters.

alter table problem_reports drop constraint problem_reports_kind_check;
alter table problem_reports add constraint problem_reports_kind_check
  check (kind in ('NOT_AVAILABLE', 'WRONG_ADDRESS', 'ROAD_BLOCKED', 'VEHICLE_PROBLEM', 'OTHER', 'NOT_REACHED'));

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'REQUEST_SCHEDULED',
  'REQUEST_RETURNED',
  'REQUEST_SENT_BACK',
  'REQUEST_SPLIT',
  'REQUEST_MOVED',
  'REQUEST_CANCELLED',
  'CANCELLATION_DECLINED',
  'CANCELLATION_REQUESTED',
  'PROBLEM_REPORTED',
  'SCHEDULE_SUBMITTED',
  'SCHEDULE_RETURNED',
  'TRIP_PUBLISHED',
  'TRIP_CHANGED',
  'STOP_REPORTED',
  'STOP_MISSED'
));

-- Internal: tells the requesters of a missed leg's stops, but not whoever reported it.
create function notify_stop_missed(p_leg public.schedule_legs, p_label text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request record;
begin
  for v_request in
    select distinct r.id, r.owner_account_id
    from public.leg_stops ls
    join public.request_destinations rd on rd.id = ls.request_destination_id
    join public.requests r on r.id = rd.request_id
    where ls.leg_id = p_leg.id and ls.revision_id = p_leg.revision_id
  loop
    if v_request.owner_account_id is distinct from p_actor then
      perform public.notify(
        v_request.owner_account_id,
        'STOP_MISSED',
        format('Your stop at %s was missed (%s). The Scheduler will plan it again', p_leg.destination_name, p_label),
        v_request.id,
        null
      );
    end if;
  end loop;
end;
$$;

revoke execute on function notify_stop_missed(public.schedule_legs, text, uuid) from public, anon, authenticated;

create or replace function report_stop(
  p_schedule_id uuid,
  p_leg_id uuid,
  p_kind text,
  p_note text default '',
  p_skip boolean default false,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null
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

  v_missed := p_kind in ('NOT_AVAILABLE', 'WRONG_ADDRESS') or (p_kind = 'ROAD_BLOCKED' and coalesce(p_skip, false));
  if v_missed and public.leg_missed(v_leg.id) then
    raise exception 'This stop was already reported missed' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'problem.report_stop', true);
  insert into public.problem_reports (
    schedule_id, revision_id, driver_id, note, leg_id, kind, missed, reported_by_account_id, lat, lng, accuracy_m
  ) values (
    p_schedule_id, v_revision.id, v_revision.driver_id, left(v_note, 500), v_leg.id, p_kind, v_missed, v_actor.id,
    p_lat, p_lng, p_accuracy_m
  ) returning * into v_report;

  if p_kind = 'VEHICLE_PROBLEM' then
    update public.schedules set paused_at = coalesce(paused_at, now()) where id = p_schedule_id;
  end if;

  v_label := case p_kind
    when 'NOT_AVAILABLE' then 'Not available'
    when 'WRONG_ADDRESS' then 'Wrong address or closed'
    when 'ROAD_BLOCKED' then case when v_missed then 'Road blocked, skipped' else 'Road blocked, waiting' end
    when 'VEHICLE_PROBLEM' then 'Vehicle problem, trip paused'
    else 'Problem' end;
  perform public.notify_schedulers(
    'STOP_REPORTED',
    format('%s at %s: %s''s trip on %s', v_label, v_leg.destination_name, v_revision.plate, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null, p_schedule_id
  );
  perform public.notify_admins(
    'STOP_REPORTED',
    format('%s at %s: %s''s trip on %s', v_label, v_leg.destination_name, v_revision.plate, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null, p_schedule_id
  );
  if v_missed then
    perform public.notify_stop_missed(v_leg, v_label, v_actor.id);
  end if;

  return v_report;
end;
$$;

-- End trip: the stops left are not reached.
create function report_unreached_stops()
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
  v_has_stops boolean;
  v_places text[] := '{}';
  v_action text := current_setting('kova.audit_action', true);
begin
  if old.end_at is not null or new.end_at is null then
    return new;
  end if;
  select * into v_schedule from public.schedules where id = new.schedule_id;
  select * into v_revision from public.schedule_revisions where id = v_schedule.published_revision_id;
  if v_revision.id is null then
    return new;
  end if;

  -- The last leg reached: tapped, or reported missed.
  select coalesce(max(l.leg_no), 0) into v_last
  from public.schedule_legs l
  where l.revision_id = v_revision.id
    and (exists (select 1 from public.stop_taps t where t.leg_id = l.id) or public.leg_missed(l.id));

  perform set_config('kova.audit_action', 'problem.not_reached', true);
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
  return new;
end;
$$;

revoke execute on function report_unreached_stops() from public, anon, authenticated;

-- After the audit row (triggers fire in name order).
create trigger trip_attendance_report_unreached
  after update of end_at on trip_attendance
  for each row execute function report_unreached_stops();

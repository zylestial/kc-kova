-- Some of the stops at a place (owner's request, 2026-10-16). Several
-- requests can share one stop (Plan together); a report was for the whole
-- stop, so if one requester's pickup wasn't ready, Not available took every
-- request there off the trip. Now the Driver can say which: a Not available
-- or Wrong address report for some of the requests at a stop names them
-- (problem_reports.request_ids). The stop is still reached (missed stays
-- false, so the Driver taps Arrived / Leaving as usual), and the Scheduler
-- plans just those again. All of them is the same as the whole stop.
--
-- report_stop: same as 0066, plus p_request_ids.
-- notify_stop_missed: same as 0066, plus p_request_ids (null: all).
-- release_missed_stop: same as 0065, except a report for some requests
-- releases just those.

alter table problem_reports
  add column request_ids uuid[],
  add constraint problem_reports_request_ids_have_leg check (request_ids is null or leg_id is not null);

drop function notify_stop_missed(public.schedule_legs, text, uuid);
create function notify_stop_missed(p_leg public.schedule_legs, p_label text, p_actor uuid, p_request_ids uuid[] default null)
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
      and (p_request_ids is null or r.id = any(p_request_ids))
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

revoke execute on function notify_stop_missed(public.schedule_legs, text, uuid, uuid[]) from public, anon, authenticated;

drop function report_stop(uuid, uuid, text, text, boolean, double precision, double precision, double precision);
create function report_stop(
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
    if v_partial and p_kind not in ('NOT_AVAILABLE', 'WRONG_ADDRESS') then
      raise exception 'Only Not available or Wrong address can be for some of the stops here' using errcode = '22023';
    end if;
  end if;

  v_missed := (p_kind in ('NOT_AVAILABLE', 'WRONG_ADDRESS') or (p_kind = 'ROAD_BLOCKED' and coalesce(p_skip, false))) and not v_partial;
  if v_missed and public.leg_missed(v_leg.id) then
    raise exception 'This stop was already reported missed' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'problem.report_stop', true);
  insert into public.problem_reports (
    schedule_id, revision_id, driver_id, note, leg_id, kind, missed, reported_by_account_id, lat, lng, accuracy_m, request_ids
  ) values (
    p_schedule_id, v_revision.id, v_revision.driver_id, left(v_note, 500), v_leg.id, p_kind, v_missed, v_actor.id,
    p_lat, p_lng, p_accuracy_m, case when v_partial then p_request_ids end
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
    format('%s at %s: %s''s trip on %s', v_label, v_leg.destination_name, v_revision.plate, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null, p_schedule_id
  );
  perform public.notify_admins(
    'STOP_REPORTED',
    format('%s at %s: %s''s trip on %s', v_label, v_leg.destination_name, v_revision.plate, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null, p_schedule_id
  );
  if v_missed or v_partial then
    perform public.notify_stop_missed(v_leg, v_label, v_actor.id, case when v_partial then p_request_ids end);
  end if;

  return v_report;
end;
$$;

revoke execute on function report_stop(uuid, uuid, text, text, boolean, double precision, double precision, double precision, uuid[]) from public, anon;
grant execute on function report_stop(uuid, uuid, text, text, boolean, double precision, double precision, double precision, uuid[]) to authenticated;

create or replace function release_missed_stop(p_problem_id uuid, p_send_back boolean default false, p_reason text default '')
returns setof public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_report public.problem_reports;
  v_schedule public.schedules;
  v_destinations uuid[];
  v_request_ids uuid[];
  v_revision_id uuid;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Only a Scheduler can plan a missed stop again' using errcode = '42501';
  end if;

  select * into v_schedule from public.schedules
  where id = (select schedule_id from public.problem_reports where id = p_problem_id)
  for update;
  select * into v_report from public.problem_reports where id = p_problem_id for update;
  if v_report.id is null then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if not v_report.missed and v_report.request_ids is null then
    raise exception 'Only a missed stop can be planned again' using errcode = '22023';
  end if;
  if v_report.status = 'HANDLED' then
    raise exception 'This missed stop was already handled. Reload and try again' using errcode = '22023';
  end if;
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This trip is no longer active' using errcode = '22023';
  end if;

  select array_agg(ls.request_destination_id), array_agg(distinct rd.request_id)
  into v_destinations, v_request_ids
  from public.leg_stops ls
  join public.request_destinations rd on rd.id = ls.request_destination_id
  where ls.leg_id = v_report.leg_id and ls.revision_id = v_schedule.published_revision_id
    and (v_report.request_ids is null or rd.request_id = any(v_report.request_ids));
  if v_request_ids is null then
    raise exception 'This stop has no requests left on the trip. Reload and try again' using errcode = '22023';
  end if;
  -- A request from before 0052 can have stops on other legs too.
  if exists (
    select 1 from public.request_destinations
    where request_id = any(v_request_ids) and active and not (id = any(v_destinations))
  ) then
    raise exception 'A request at this stop has other stops on the trip; change the trip instead' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'problem.release_missed', true);
  perform set_config('kova.audit_is_override', (v_actor.role = 'Admin')::text, true);

  -- Off the version the Driver follows, and off draft changes to it.
  for v_revision_id in
    select id from public.schedule_revisions
    where schedule_id = v_schedule.id
      and (id = v_schedule.published_revision_id or status in ('DRAFT', 'SUBMITTED', 'RETURNED'))
  loop
    perform set_config('kova.live_edit_revision', v_revision_id::text, true);
    delete from public.leg_stops where revision_id = v_revision_id and request_destination_id = any(v_destinations);
    delete from public.revision_requests where revision_id = v_revision_id and request_id = any(v_request_ids);
    perform set_config('kova.live_edit_revision', '', true);
    update public.schedule_revisions set row_version = row_version + 1, updated_at = now() where id = v_revision_id;
  end loop;
  update public.schedules set updated_at = now() where id = v_schedule.id;
  perform public.sync_schedule_inclusions(v_schedule.id);

  -- Missed: the Scheduler may now move them to any day (move_request_day).
  update public.requests set missed_at = coalesce(missed_at, now()), row_version = row_version + 1, updated_at = now()
  where id = any(v_request_ids);

  update public.problem_reports set
    status = 'HANDLED',
    handled_at = now(),
    handled_by_account_id = v_actor.id,
    handling_note = case when p_send_back then 'Sent back to the requester' else 'Planned again' end
  where id = p_problem_id;

  if p_send_back then
    perform public.send_back_requests(v_request_ids, p_reason);
  end if;

  return query select * from public.requests where id = any(v_request_ids) order by id;
end;
$$;

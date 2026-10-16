-- The Scheduler answers every stop report (owner's call, 2026-10-16). Until
-- now a report acted at once: Not available or Wrong address made the stop
-- missed and the Driver went on; a blocked road was the Driver's to skip or
-- wait; a vehicle problem paused the trip until the Driver tapped Resume.
-- Now every report holds the trip (schedules.paused_at, 0061: no Arrived /
-- Leaving) until a Scheduler or Admin answers (answer_stop_report):
--
--   SKIP    go on to the next stop: the stop (or the requests the report
--           names, 0067) is missed, to plan again, move or send back (0063,
--           0065), and its requesters are told (STOP_MISSED)
--   WAIT    stay: the stop is kept and the Driver goes on when it's ready
--   END     end the trip: the Driver taps End trip now, and the stops left
--           are not reached (0066)
--   CHANGE  the Scheduler changes the route: the trip stays held until the
--           Admin approves the change (apply_changes_on_road); until then
--           another answer can still be given
--
-- The Driver (or the Company trip's requester who reported it) is told the
-- answer (STOP_ANSWERED). The trip stays held while any report waits. End
-- trip still works, and closes the reports still waiting. resume_trip is
-- gone: a Scheduler or Admin answers instead.
--
-- report_stop: same as 0067 (p_skip no longer used), except it holds the
--   trip, never makes the stop missed, and leaves telling requesters to
--   the answer.
-- release_missed_stop: same as 0067, except a report for some requests
--   needs the answer Skip.
-- apply_changes_on_road: same as 0063, plus ending a "Change the route" hold.
-- report_unreached_stops: same as 0066, plus closing reports still waiting.

alter table problem_reports
  add column decision text check (decision in ('SKIP', 'WAIT', 'END', 'CHANGE')),
  add column decided_at timestamptz,
  add column decided_by_account_id uuid references accounts (id),
  add constraint problem_reports_decision_has_leg check (decision is null or leg_id is not null),
  add constraint problem_reports_decided check ((decision is null) = (decided_at is null));

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
  'STOP_MISSED',
  'STOP_ANSWERED'
));

-- Internal: how a kind of report reads in messages.
create function stop_report_label(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'NOT_AVAILABLE' then 'Not available'
    when 'WRONG_ADDRESS' then 'Wrong address or closed'
    when 'ROAD_BLOCKED' then 'Road blocked or bad weather'
    when 'VEHICLE_PROBLEM' then 'Vehicle problem'
    when 'NOT_REACHED' then 'Not reached'
    else 'Problem' end;
$$;

-- Internal: the trip is held while any of its stop reports waits for an answer.
create function refresh_trip_hold(p_schedule_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.schedules set paused_at = case
    when exists (
      select 1 from public.problem_reports
      where schedule_id = p_schedule_id and leg_id is not null and status = 'OPEN'
        and kind <> 'NOT_REACHED' and (decision is null or decision = 'CHANGE')
    ) then coalesce(paused_at, now())
    else null end
  where id = p_schedule_id;
end;
$$;

revoke execute on function stop_report_label(text) from public, anon, authenticated;
revoke execute on function refresh_trip_hold(uuid) from public, anon, authenticated;

-- No Arrived / Leaving while the trip waits for an answer.
create or replace function refuse_tap_while_paused()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.schedules where id = new.schedule_id and paused_at is not null) then
    raise exception 'Wait for the Scheduler''s answer first' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop function resume_trip(uuid);

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
    if v_partial and p_kind not in ('NOT_AVAILABLE', 'WRONG_ADDRESS') then
      raise exception 'Only Not available or Wrong address can be for some of the stops here' using errcode = '22023';
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

-- A Scheduler or Admin answers a stop report: SKIP, WAIT, END or CHANGE.
create function answer_stop_report(p_problem_id uuid, p_decision text)
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
    v_message := format('Skip %s and go on to the next stop', v_leg.destination_name);
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

revoke execute on function answer_stop_report(uuid, text) from public, anon;
grant execute on function answer_stop_report(uuid, text) to authenticated;

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
  if not v_report.missed and not (v_report.request_ids is not null and v_report.decision = 'SKIP') then
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

create or replace function apply_changes_on_road(
  p_schedule public.schedules,
  p_draft public.schedule_revisions,
  p_actor public.accounts
) returns public.schedule_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_published public.schedule_revisions;
  v_legs jsonb;
  v_request_ids uuid[];
  v_before_requests uuid[];
  v_last_tapped smallint;
  v_locked_before text[];
  v_owner_id uuid;
  v_date text := to_char(p_schedule.schedule_date, 'FMMonth FMDD, YYYY');
  v_refused text := 'The Driver has already reached a stop this change moves. Return it to the Scheduler to redo';
begin
  select * into v_published from public.schedule_revisions where id = p_schedule.published_revision_id for update;
  if exists (select 1 from public.trip_attendance where schedule_id = p_schedule.id and end_at is not null)
     or exists (select 1 from public.company_trip_runs where schedule_id = p_schedule.id and end_at is not null) then
    raise exception 'This trip has already ended' using errcode = '22023';
  end if;
  if p_draft.plate <> v_published.plate or p_draft.driver_id <> v_published.driver_id then
    raise exception 'A trip on the road can''t change vehicle or Driver' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', coalesce(l.source_leg_id, l.id),
      'destinationId', l.destination_id,
      'plannedTimeOut', to_char(l.planned_time_out, 'HH24:MI'),
      'plannedTimeIn', to_char(l.planned_time_in, 'HH24:MI'),
      'contactName', l.contact_name,
      'contactNumber', l.contact_number,
      'isFinal', l.is_final,
      'stops', (select coalesce(jsonb_agg(ls.request_destination_id), '[]'::jsonb) from public.leg_stops ls where ls.leg_id = l.id)
    ) order by l.leg_no), '[]'::jsonb)
  into v_legs
  from public.schedule_legs l where l.revision_id = p_draft.id;
  select coalesce(array_agg(request_id), '{}') into v_request_ids from public.revision_requests where revision_id = p_draft.id;
  select coalesce(array_agg(request_id), '{}') into v_before_requests from public.revision_requests where revision_id = v_published.id;

  -- The legs that can't change: up to the last one tapped or reported
  -- missed (0063).
  select max(l.leg_no) into v_last_tapped
  from public.schedule_legs l
  where l.revision_id = v_published.id
    and (exists (select 1 from public.stop_taps t where t.leg_id = l.id) or public.leg_missed(l.id));
  v_locked_before := public.leg_snapshot(v_published.id, coalesce(v_last_tapped, 0));
  if exists (
    select 1 from public.schedule_legs l
    where l.revision_id = v_published.id and l.leg_no <= coalesce(v_last_tapped, 0)
      and not exists (select 1 from jsonb_array_elements(v_legs) leg where leg.value ->> 'id' = l.id::text)
  ) then
    raise exception '%', v_refused using errcode = '22023';
  end if;

  delete from public.schedule_reservations where revision_id = p_draft.id;
  perform set_config('kova.live_edit_revision', v_published.id::text, true);
  perform public.write_revision_content(v_published.id, p_schedule.schedule_date, v_request_ids, v_legs);
  perform set_config('kova.live_edit_revision', '', true);
  perform public.assert_revision_complete(v_published.id);
  if public.leg_snapshot(v_published.id, coalesce(v_last_tapped, 0)) is distinct from v_locked_before then
    raise exception '%', v_refused using errcode = '22023';
  end if;

  update public.schedule_revisions set
    status = 'SUPERSEDED',
    decided_at = now(),
    decided_by_account_id = p_actor.id,
    decision_comment = '',
    row_version = row_version + 1,
    updated_at = now()
  where id = p_draft.id;
  update public.schedule_revisions set row_version = row_version + 1, updated_at = now()
  where id = v_published.id
  returning * into v_published;
  update public.schedules set updated_at = now() where id = p_schedule.id;
  perform public.sync_schedule_inclusions(p_schedule.id);

  perform public.notify(
    v_published.driver_id, 'TRIP_CHANGED',
    format('Your trip on %s was changed. Check your next stop', v_date),
    null, p_schedule.id
  );
  -- A Company trip is recorded by its requester (0055), so they're told
  -- too; on a Daily trip, a requester newly on it is told it's scheduled.
  for v_owner_id in
    select distinct r.owner_account_id from public.requests r
    where r.id = any(v_request_ids)
      and (p_schedule.kind = 'COMPANY' or not (r.id = any(v_before_requests)))
      and r.owner_account_id <> v_published.driver_id
  loop
    perform public.notify(
      v_owner_id,
      case when p_schedule.kind = 'COMPANY' then 'TRIP_CHANGED' else 'REQUEST_SCHEDULED' end,
      case when p_schedule.kind = 'COMPANY'
        then format('Your Company trip on %s was changed. Check your next stop', v_date)
        else format('Your request for %s was scheduled', v_date) end,
      null, p_schedule.id
    );
  end loop;

  -- Reports answered "Change the route" are done; the trip goes on if nothing else holds it.
  update public.problem_reports set status = 'HANDLED', handled_at = now(), handled_by_account_id = p_actor.id,
    handling_note = 'Route changed'
  where schedule_id = p_schedule.id and status = 'OPEN' and decision = 'CHANGE';
  perform public.refresh_trip_hold(p_schedule.id);

  return v_published;
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
  v_has_stops boolean;
  v_places text[] := '{}';
  v_action text := current_setting('kova.audit_action', true);
begin
  if old.end_at is not null or new.end_at is null then
    return new;
  end if;
  select * into v_schedule from public.schedules where id = new.schedule_id;
  -- Reports still waiting for an answer end with the trip.
  update public.problem_reports set status = 'HANDLED', handled_at = now(), handling_note = 'The trip ended'
  where schedule_id = new.schedule_id and leg_id is not null and status = 'OPEN' and (decision is null or decision = 'CHANGE');
  update public.schedules set paused_at = null where id = new.schedule_id;
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

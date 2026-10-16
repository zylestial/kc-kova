-- The Scheduler handles stop reports (0061) on Scheduling.
--
-- A missed stop's requests come off the trip so they can be planned again:
-- release_missed_stop takes them off the version the Driver follows and
-- off any draft changes to it, without Admin approval: the Driver has
-- already been there, so the route they drive doesn't change. The missed
-- leg stays on the route (and the printed form) with no stops. The
-- requests are then waiting again, to Fit in on a trip like any other, or
-- are sent back to their requester (send_back_requests, 0038). The report
-- is marked handled.
--
-- write_revision_content: same as 0060, except a missed leg with no stops
-- keeps its destination (it isn't an Other stop).
-- apply_changes_on_road: same as 0060, except a stop reported missed is
-- reached, like a tapped one: it and the legs before it can't change.
-- handle_problem: same as 0031, except a Scheduler may mark a stop report
-- handled.


create or replace function write_revision_content(
  p_revision_id uuid,
  p_schedule_date date,
  p_request_ids uuid[],
  p_legs jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_legs jsonb := coalesce(p_legs, '[]'::jsonb);
  v_leg jsonb;
  v_no int := 0;
  v_prev_destination text := 'ANONANG';
  v_prev_in time(0);
  v_out time(0);
  v_in time(0);
  v_first_out time(0);
  v_last_in time(0);
  v_is_final boolean;
  v_final_seen boolean := false;
  v_destination public.booking_options;
  v_destination_id text;
  v_destination_name text;
  v_leg_id uuid;
  v_stop text;
  v_stops jsonb;
  v_first_stop public.request_destinations;
  v_request_destination public.request_destinations;
  v_out_text text;
  v_in_text text;
  v_all_timed boolean := true;
  v_kind text;
  v_kept uuid[];
  v_existing public.schedule_legs;
  v_source uuid;
  v_missed_leg public.schedule_legs;
begin
  select s.kind into v_kind
  from public.schedule_revisions sr join public.schedules s on s.id = sr.schedule_id
  where sr.id = p_revision_id;
  if v_kind = 'COMPANY' then
    select g.starting_point_name into v_prev_destination
    from public.requests r join public.request_groups g on g.id = r.group_id
    where r.id = any(p_request_ids)
    order by r.id
    limit 1;
    v_prev_destination := coalesce(v_prev_destination, '');
  end if;

  if jsonb_typeof(v_legs) <> 'array' then
    raise exception 'Legs must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(v_legs) > 8 then
    raise exception 'A schedule can have at most 8 legs%', case when v_kind = 'COMPANY' then '' else ', including the final leg back to ANONANG' end using errcode = '22023';
  end if;

  -- Legs sent back with their id are kept (their taps point at them); the
  -- rest go. Kept legs move out of the way of the new numbering first
  -- (unique (revision_id, leg_no)).
  select coalesce(array_agg(l.id), '{}') into v_kept
  from public.schedule_legs l
  where l.revision_id = p_revision_id
    and l.id::text in (select value ->> 'id' from jsonb_array_elements(v_legs) where value ? 'id');
  delete from public.leg_stops where revision_id = p_revision_id;
  delete from public.schedule_legs where revision_id = p_revision_id and not (id = any(v_kept));
  update public.schedule_legs set leg_no = leg_no + 100 where revision_id = p_revision_id;
  delete from public.revision_requests where revision_id = p_revision_id;
  insert into public.revision_requests (revision_id, request_id)
  select p_revision_id, unnest(p_request_ids);

  for v_leg in select value from jsonb_array_elements(v_legs) loop
    v_no := v_no + 1;
    if v_final_seen then
      raise exception 'The final leg back to ANONANG must be the last leg' using errcode = '22023';
    end if;

    v_is_final := coalesce((v_leg ->> 'isFinal')::boolean, false);
    v_stops := coalesce(v_leg -> 'stops', '[]'::jsonb);

    -- A leg's times may both be left blank while saving a draft (checked
    -- before submit by assert_revision_complete); one filled in without the
    -- other, or filled in badly, is still rejected here.
    v_out_text := coalesce(v_leg ->> 'plannedTimeOut', '');
    v_in_text := coalesce(v_leg ->> 'plannedTimeIn', '');
    if v_out_text = '' and v_in_text = '' then
      v_out := null;
      v_in := null;
      v_all_timed := false;
    else
      if v_out_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_in_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Leg %: enter planned times as HH:MM', v_no using errcode = '22023';
      end if;
      v_out := v_out_text::time(0);
      v_in := v_in_text::time(0);
      if v_in <= v_out then
        raise exception 'Leg %: planned Time In must be after Time Out', v_no using errcode = '22023';
      end if;
      if v_prev_in is not null and v_out < v_prev_in then
        raise exception 'Leg %: planned Time Out can''t be before the previous leg''s Time In', v_no using errcode = '22023';
      end if;
    end if;

    if v_is_final and v_kind = 'COMPANY' then
      raise exception 'A Company Trip ends at its last destination; it has no leg back to ANONANG' using errcode = '22023';
    end if;
    if v_is_final then
      if jsonb_array_length(v_stops) > 0 then
        raise exception 'The final leg back to ANONANG has no request stops' using errcode = '22023';
      end if;
      v_destination_id := null;
      v_destination_name := 'ANONANG';
      v_final_seen := true;
    else
      v_first_stop := null;
      if jsonb_array_length(v_stops) > 0 then
        select * into v_first_stop from public.request_destinations
        where id = (v_stops ->> 0)::uuid;
      end if;

      -- v_first_stop.id (never null once found) rather than the row itself:
      -- a composite value's own "is not null" is true only when every field
      -- is non-null, and an Other stop's destination_id/purpose_id are null
      -- by design.
      -- A stop reported missed whose requests were planned again stays
      -- on the route where it was, with no stops (0063).
      v_missed_leg := null;
      if jsonb_array_length(v_stops) = 0 then
        select l.* into v_missed_leg
        from public.schedule_legs l
        join public.schedule_revisions r on r.id = l.revision_id
        where l.id::text = v_leg ->> 'id'
          and r.schedule_id = (select schedule_id from public.schedule_revisions where id = p_revision_id)
          and public.leg_missed(coalesce(l.source_leg_id, l.id));
      end if;

      if v_missed_leg.id is not null then
        v_destination_id := v_missed_leg.destination_id;
        v_destination_name := v_missed_leg.destination_name;
      elsif v_first_stop.id is not null and v_first_stop.destination_is_other then
        -- An Other-destination leg: derive the destination from the stop
        -- itself, never from booking_options (there is no id to look up).
        v_destination_id := null;
        v_destination_name := v_first_stop.destination_name;
      else
        select * into v_destination from public.booking_options
        where "group" = 'destinations' and id = v_leg ->> 'destinationId';
        if v_destination is null then
          raise exception 'Leg %: choose a destination', v_no using errcode = '22023';
        end if;
        -- A leg with no request stops is a new selection, so it needs an
        -- Active option; a leg serving requests uses whatever they asked for.
        if jsonb_array_length(v_stops) = 0 and v_destination.status <> 'Active' then
          raise exception 'Leg %: destination is not an active option', v_no using errcode = '22023';
        end if;
        if jsonb_array_length(v_stops) = 0 and not v_destination.is_other_stop then
          raise exception 'Leg %: a destination with no request needs to be marked as an other stop', v_no using errcode = '22023';
        end if;
        v_destination_id := v_destination.id;
        v_destination_name := v_destination.name;
      end if;
    end if;

    select * into v_existing from public.schedule_legs
    where revision_id = p_revision_id and id = any(v_kept) and id::text = v_leg ->> 'id';
    if v_existing.id is not null then
      if v_existing.leg_no < 100 then
        raise exception 'Leg %: the same leg is listed twice', v_no using errcode = '22023';
      end if;
      update public.schedule_legs set
        leg_no = v_no,
        origin = v_prev_destination,
        destination_id = v_destination_id,
        destination_name = v_destination_name,
        planned_time_out = v_out,
        planned_time_in = v_in,
        contact_name = coalesce(trim(v_leg ->> 'contactName'), ''),
        contact_number = coalesce(trim(v_leg ->> 'contactNumber'), ''),
        is_final = v_is_final
      where id = v_existing.id
      returning id into v_leg_id;
    else
      -- A leg of another version of this schedule: this one came from it.
      select coalesce(l.source_leg_id, l.id) into v_source
      from public.schedule_legs l
      join public.schedule_revisions r on r.id = l.revision_id
      where l.id::text = v_leg ->> 'id' and l.revision_id <> p_revision_id
        and r.schedule_id = (select schedule_id from public.schedule_revisions where id = p_revision_id);
      insert into public.schedule_legs (
        revision_id, leg_no, origin, destination_id, destination_name,
        planned_time_out, planned_time_in, contact_name, contact_number, is_final, source_leg_id
      ) values (
        p_revision_id, v_no, v_prev_destination, v_destination_id, v_destination_name,
        v_out, v_in, coalesce(trim(v_leg ->> 'contactName'), ''), coalesce(trim(v_leg ->> 'contactNumber'), ''),
        v_is_final, v_source
      ) returning id into v_leg_id;
    end if;

    for v_stop in select jsonb_array_elements_text(v_stops) loop
      select * into v_request_destination from public.request_destinations where id = v_stop::uuid;
      if v_request_destination is null or not v_request_destination.active
         or not (v_request_destination.request_id = any(p_request_ids)) then
        raise exception 'Leg %: a stop belongs to a request that isn''t in this schedule', v_no using errcode = '22023';
      end if;
      if v_request_destination.destination_is_other then
        if v_destination_id is not null or v_request_destination.destination_name <> v_destination_name then
          raise exception 'Leg %: a stop''s destination doesn''t match the leg''s destination', v_no using errcode = '22023';
        end if;
      elsif v_request_destination.destination_id <> v_destination_id then
        raise exception 'Leg %: a stop''s destination doesn''t match the leg''s destination', v_no using errcode = '22023';
      end if;
      if exists (
        select 1 from public.leg_stops
        where revision_id = p_revision_id and request_destination_id = v_request_destination.id
      ) then
        raise exception 'Leg %: a request destination can only be served by one leg', v_no using errcode = '22023';
      end if;
      insert into public.leg_stops (leg_id, revision_id, request_destination_id)
      values (v_leg_id, p_revision_id, v_request_destination.id);
    end loop;

    v_prev_destination := v_destination_name;
    v_prev_in := v_in;
    v_first_out := coalesce(v_first_out, v_out);
    v_last_in := v_in;
  end loop;

  delete from public.schedule_reservations where revision_id = p_revision_id;
  if v_all_timed and v_first_out is not null then
    insert into public.schedule_reservations (revision_id, schedule_id, plate, driver_id, period)
    select sr.id, sr.schedule_id, sr.plate, sr.driver_id,
      tstzrange(
        (p_schedule_date + v_first_out) at time zone 'Asia/Manila',
        (p_schedule_date + v_last_in) at time zone 'Asia/Manila',
        '[)'
      )
    from public.schedule_revisions sr
    where sr.id = p_revision_id;
  end if;
exception
  when exclusion_violation then
    raise exception 'This vehicle or Driver is already reserved for part of that time' using errcode = '23P01';
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

  return v_published;
end;
$$;

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

-- Takes a missed stop's requests off the trip (see the top). p_send_back:
-- send them back to their requester with p_reason rather than plan them again.
create function release_missed_stop(p_problem_id uuid, p_send_back boolean default false, p_reason text default '')
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
  if not v_report.missed then
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
  where ls.leg_id = v_report.leg_id and ls.revision_id = v_schedule.published_revision_id;
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

revoke execute on function release_missed_stop(uuid, boolean, text) from public, anon;
grant execute on function release_missed_stop(uuid, boolean, text) to authenticated;

-- Changing a trip that's on the road (owner's request, 2026-10-16). Until
-- now every change went through a new revision whose legs
-- write_revision_content deleted and re-inserted with new ids, so approving
-- changes to a started trip left its stop_taps (0045) and time corrections
-- (0046) pointing at the old revision: the taps looked missing and the
-- Driver couldn't tap those stops again.
--
-- Now a started trip (Start trip tapped, or a Company trip's run begun) is
-- changed in place on its published revision with edit_live_trip, straight
-- to the Driver with no Admin approval (Admins are told). Legs the Driver
-- has already tapped, and every leg before them, keep their ids and can't
-- change; later legs can be added, changed, moved or removed.
-- save_schedule_draft and approve_schedule now refuse a started trip.
--
-- write_revision_content: same as 0054, except a leg sent with the "id" of
-- a leg already in that revision is updated in place (keeping its id)
-- instead of deleted and inserted again.

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
      if v_first_stop.id is not null and v_first_stop.destination_is_other then
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
      insert into public.schedule_legs (
        revision_id, leg_no, origin, destination_id, destination_name,
        planned_time_out, planned_time_in, contact_name, contact_number, is_final
      ) values (
        p_revision_id, v_no, v_prev_destination, v_destination_id, v_destination_name,
        v_out, v_in, coalesce(trim(v_leg ->> 'contactName'), ''), coalesce(trim(v_leg ->> 'contactNumber'), ''),
        v_is_final
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


-- Same as 0015, except edit_live_trip may change the published version it
-- names in kova.live_edit_revision (set only inside that RPC, for its own
-- transaction).
create or replace function prevent_closed_revision_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_revision_id uuid;
begin
  v_revision_id := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
  if v_revision_id::text = coalesce(current_setting('kova.live_edit_revision', true), '') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if exists (
    select 1 from public.schedule_revisions
    where id = v_revision_id and status not in ('DRAFT', 'SUBMITTED', 'RETURNED')
  ) then
    raise exception 'This schedule version is closed and cannot be changed' using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


-- Internal: the trip has begun (a Daily trip's Start trip, or a Company
-- trip's run started).
create function trip_started(p_schedule_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (select 1 from public.trip_attendance where schedule_id = p_schedule_id)
    or exists (select 1 from public.company_trip_runs where schedule_id = p_schedule_id);
$$;

revoke execute on function trip_started(uuid) from public, anon, authenticated;


-- Once a trip has started, no version other than the published one can be
-- saved, submitted or approved: approving one would swap in new legs and
-- strand the Driver's taps. A waiting version may still be returned or
-- discarded (edit_live_trip discards it). This covers save_schedule_draft,
-- submit_schedule and approve_schedule without restating them.
create function refuse_revision_on_started_trip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('DRAFT', 'SUBMITTED', 'APPROVED')
     and new.id is distinct from (select published_revision_id from public.schedules where id = new.schedule_id)
     and public.trip_started(new.schedule_id) then
    raise exception 'This trip is on the road; change it with Change route on Scheduling' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function refuse_revision_on_started_trip() from public, anon, authenticated;

create trigger schedule_revisions_not_on_started_trip
  before insert or update on schedule_revisions
  for each row execute function refuse_revision_on_started_trip();


-- Internal: legs 1..p_through of a version as text (id, destination,
-- times, stops), to check a live edit left them alone.
create function leg_snapshot(p_revision_id uuid, p_through int)
returns text[]
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(array_agg(format('%s|%s|%s|%s|%s', l.id, l.destination_name, l.planned_time_out, l.planned_time_in,
           (select string_agg(ls.request_destination_id::text, ',' order by ls.request_destination_id)
            from public.leg_stops ls where ls.leg_id = l.id)) order by l.leg_no), '{}')
  from public.schedule_legs l
  where l.revision_id = p_revision_id and l.leg_no <= p_through;
$$;

revoke execute on function leg_snapshot(uuid, int) from public, anon, authenticated;


-- Changes a trip that's on the road, in place on its published version.
-- Scheduler (or Admin, as an override). Legs up to the last one the Driver
-- tapped stay exactly as they are; the rest can change. No Admin approval:
-- the Driver sees it straight away, and the Driver, Admins and any
-- requester newly on the trip are told. A version waiting for approval is
-- discarded: this one replaces it.
create function edit_live_trip(
  p_schedule_id uuid,
  p_expected_row_version integer,
  p_request_ids uuid[],
  p_legs jsonb
) returns public.schedule_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_request public.requests;
  v_request_ids uuid[];
  v_before_requests uuid[];
  v_last_tapped smallint;
  v_locked_before text[];
  v_locked_after text[];
  v_owner_id uuid;
  v_date text;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Not authorized to edit schedules' using errcode = '42501';
  end if;

  perform set_config('kova.audit_action', 'schedule.live_edit', true);
  if v_actor.role = 'Admin' then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;
  if v_schedule.status <> 'ACTIVE' or v_schedule.published_revision_id is null then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;
  if not public.trip_started(p_schedule_id) then
    raise exception 'This trip hasn''t started yet; propose changes instead' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_attendance where schedule_id = p_schedule_id and end_at is not null)
     or exists (select 1 from public.company_trip_runs where schedule_id = p_schedule_id and end_at is not null)
     or exists (select 1 from public.trip_completions where schedule_id = p_schedule_id) then
    raise exception 'This trip has already ended' using errcode = '22023';
  end if;

  select * into v_revision from public.schedule_revisions
  where id = v_schedule.published_revision_id
  for update;
  if v_revision.row_version is distinct from p_expected_row_version then
    raise exception 'This schedule was changed elsewhere. Reload it and try again' using errcode = 'PT409';
  end if;

  -- The legs that can't change: up to the last one tapped.
  select max(l.leg_no) into v_last_tapped
  from public.stop_taps t join public.schedule_legs l on l.id = t.leg_id
  where t.revision_id = v_revision.id;
  v_locked_before := public.leg_snapshot(v_revision.id, coalesce(v_last_tapped, 0));
  if exists (
    select 1 from public.schedule_legs l
    where l.revision_id = v_revision.id and l.leg_no <= coalesce(v_last_tapped, 0)
      and not exists (
        select 1 from jsonb_array_elements(coalesce(p_legs, '[]'::jsonb)) leg where leg.value ->> 'id' = l.id::text
      )
  ) then
    raise exception 'Stops the Driver has already reached can''t be changed' using errcode = '22023';
  end if;

  select coalesce(array_agg(request_id), '{}') into v_before_requests
  from public.revision_requests where revision_id = v_revision.id;

  select coalesce(array_agg(distinct id), '{}') into v_request_ids from unnest(p_request_ids) as ids (id);
  if cardinality(v_request_ids) = 0 then
    raise exception 'Include at least one request' using errcode = '22023';
  end if;
  perform 1 from public.requests where id = any(v_request_ids) order by id for update;
  if (select count(*) from public.requests where id = any(v_request_ids)) <> cardinality(v_request_ids) then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  for v_request in select * from public.requests where id = any(v_request_ids) loop
    if v_request.status <> 'ACTIVE' then
      raise exception 'A selected request has been cancelled' using errcode = '22023';
    end if;
    if v_request.requested_date <> v_schedule.schedule_date then
      raise exception 'A selected request is for a different date' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.schedule_requests
      where request_id = v_request.id and active and schedule_id <> v_schedule.id
    ) then
      raise exception 'A selected request is already in another schedule' using errcode = '23505';
    end if;
  end loop;

  -- A version waiting for approval would otherwise come back over this one.
  delete from public.schedule_reservations
  where revision_id in (
    select id from public.schedule_revisions
    where schedule_id = p_schedule_id and status in ('DRAFT', 'SUBMITTED', 'RETURNED')
  );
  update public.schedule_revisions set status = 'DISCARDED', updated_at = now()
  where schedule_id = p_schedule_id and status in ('DRAFT', 'SUBMITTED', 'RETURNED');

  perform set_config('kova.live_edit_revision', v_revision.id::text, true);
  perform public.write_revision_content(v_revision.id, v_schedule.schedule_date, v_request_ids, p_legs);
  perform set_config('kova.live_edit_revision', '', true);
  perform public.assert_revision_complete(v_revision.id);

  v_locked_after := public.leg_snapshot(v_revision.id, coalesce(v_last_tapped, 0));
  if v_locked_after is distinct from v_locked_before then
    raise exception 'Stops the Driver has already reached can''t be changed' using errcode = '22023';
  end if;

  update public.schedule_revisions set row_version = row_version + 1, updated_at = now()
  where id = v_revision.id
  returning * into v_revision;
  update public.schedules set updated_at = now() where id = p_schedule_id;
  perform public.sync_schedule_inclusions(p_schedule_id);

  v_date := to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY');
  perform public.notify(
    v_revision.driver_id, 'TRIP_CHANGED',
    format('Your trip on %s was changed. Check your next stop', v_date),
    null, p_schedule_id
  );
  -- A Company trip is recorded by its requester (0055), so they're told
  -- too; on a Daily trip, a requester newly on it is told it's scheduled.
  for v_owner_id in
    select distinct r.owner_account_id from public.requests r
    where r.id = any(v_request_ids)
      and (v_schedule.kind = 'COMPANY' or not (r.id = any(v_before_requests)))
      and r.owner_account_id <> v_revision.driver_id
  loop
    perform public.notify(
      v_owner_id,
      case when v_schedule.kind = 'COMPANY' then 'TRIP_CHANGED' else 'REQUEST_SCHEDULED' end,
      case when v_schedule.kind = 'COMPANY'
        then format('Your Company trip on %s was changed. Check your next stop', v_date)
        else format('Your request for %s was scheduled', v_date) end,
      null, p_schedule_id
    );
  end loop;
  perform public.notify_admins(
    'LIVE_TRIP_CHANGED',
    format('%s changed %s''s trip on %s while it was on the road', v_actor.name, v_revision.plate, v_date),
    null, p_schedule_id
  );

  return v_revision;
end;
$$;

revoke execute on function edit_live_trip(uuid, integer, uuid[], jsonb) from public, anon;
grant execute on function edit_live_trip(uuid, integer, uuid[], jsonb) to authenticated;


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
  'LIVE_TRIP_CHANGED'
));

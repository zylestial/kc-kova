-- v2.2: the Planner builds legs from the request pool automatically, so a
-- Scheduler no longer hand-picks a destination for a request-linked leg.
-- A leg with no request stops (an "other stop", e.g. a fuel or errand stop)
-- is still allowed, but only for a destination an Admin has explicitly
-- flagged for that use — otherwise a client bug or a direct API call could
-- leave (or create) a stop-less leg that doesn't belong to anyone.
alter table booking_options add column is_other_stop boolean not null default false;

-- A leg's planned times are no longer required to save a draft — a
-- Scheduler can pin down the route first and fill times in later — only to
-- submit it (enforced below in assert_revision_complete). The existing
-- `planned_time_in > planned_time_out` check already passes when either
-- side is null, so it only needs to stop a leg having just one of the two.
alter table schedule_legs alter column planned_time_out drop not null;
alter table schedule_legs alter column planned_time_in drop not null;
alter table schedule_legs add constraint schedule_legs_times_both_or_neither
  check ((planned_time_out is null) = (planned_time_in is null));

-- Same as 0021, plus: every leg needs real times before a revision can be
-- submitted, now that write_revision_content allows saving a draft without
-- them.
create or replace function assert_revision_complete(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if not exists (select 1 from public.revision_requests where revision_id = p_revision_id) then
    raise exception 'Include at least one request' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.revision_requests rr
    join public.requests r on r.id = rr.request_id
    where rr.revision_id = p_revision_id and r.status <> 'ACTIVE'
  ) then
    raise exception 'A request in this schedule has been cancelled; remove it first' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.schedule_legs
    where revision_id = p_revision_id and (planned_time_out is null or planned_time_in is null)
  ) then
    raise exception 'Enter planned Time Out and Time In for every leg' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.schedule_legs l
    where l.revision_id = p_revision_id and l.is_final
      and l.leg_no = (select max(leg_no) from public.schedule_legs where revision_id = p_revision_id)
  ) then
    raise exception 'Add the final leg back to ANONANG' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.revision_requests rr
    join public.request_destinations rd on rd.request_id = rr.request_id and rd.active
    where rr.revision_id = p_revision_id
      and not exists (
        select 1 from public.leg_stops ls
        where ls.revision_id = p_revision_id and ls.request_destination_id = rd.id
      )
  ) then
    raise exception 'Every destination of every included request must be on a leg' using errcode = '22023';
  end if;
end;
$$;

-- Same as 0027, plus: a non-final leg with no request stops is rejected
-- unless its destination is flagged is_other_stop, and a leg's times may
-- both be left blank (see above) — a reservation is only recorded once
-- every leg is timed, matching the client's own "no window until fully
-- timed" rule (lib/trip-record.ts, tripWindow).
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
  v_request_destination public.request_destinations;
  v_out_text text;
  v_in_text text;
  v_all_timed boolean := true;
begin
  if jsonb_typeof(v_legs) <> 'array' then
    raise exception 'Legs must be a list' using errcode = '22023';
  end if;
  if jsonb_array_length(v_legs) > 8 then
    raise exception 'A schedule can have at most 8 legs, including the final leg back to ANONANG' using errcode = '22023';
  end if;

  delete from public.schedule_legs where revision_id = p_revision_id;
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

    if v_is_final then
      if jsonb_array_length(v_stops) > 0 then
        raise exception 'The final leg back to ANONANG has no request stops' using errcode = '22023';
      end if;
      v_destination_id := null;
      v_destination_name := 'ANONANG';
      v_final_seen := true;
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

    insert into public.schedule_legs (
      revision_id, leg_no, origin, destination_id, destination_name,
      planned_time_out, planned_time_in, contact_name, contact_number, is_final
    ) values (
      p_revision_id, v_no, v_prev_destination, v_destination_id, v_destination_name,
      v_out, v_in, coalesce(trim(v_leg ->> 'contactName'), ''), coalesce(trim(v_leg ->> 'contactNumber'), ''),
      v_is_final
    ) returning id into v_leg_id;

    for v_stop in select jsonb_array_elements_text(v_stops) loop
      select * into v_request_destination from public.request_destinations where id = v_stop::uuid;
      if v_request_destination is null or not v_request_destination.active
         or not (v_request_destination.request_id = any(p_request_ids)) then
        raise exception 'Leg %: a stop belongs to a request that isn''t in this schedule', v_no using errcode = '22023';
      end if;
      if v_request_destination.destination_id <> v_destination_id then
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

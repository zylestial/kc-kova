-- Where a leg came from (source_leg_id, 0060) is always a leg of the route
-- the Driver follows. Until now a leg that approved changes added to a trip
-- on the road pointed at the draft leg it was copied from, and draft
-- changes made after that copied the pointer: they never matched that
-- leg's taps (the Scheduler saw it as not reached), and approving them
-- replaced the leg, losing its taps. A trip changed before it started kept
-- pointers to its earlier version the same way.
--
-- write_revision_content: same as 0063, except
--   * a leg new to the Driver's route has no source_leg_id, and a draft leg
--     copied from the Driver's route points at that leg itself;
--   * a missed leg is found by its own id or the one it came from.

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
          and (public.leg_missed(l.id) or public.leg_missed(l.source_leg_id));
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
      -- A leg of another version of this schedule: this one came from the
      -- leg of the Driver's route it copies (0064). A leg new to the Driver's
      -- route itself comes from nowhere.
      select case when r.id = s.published_revision_id then l.id else l.source_leg_id end into v_source
      from public.schedule_legs l
      join public.schedule_revisions r on r.id = l.revision_id
      join public.schedules s on s.id = r.schedule_id
      where l.id::text = v_leg ->> 'id' and l.revision_id <> p_revision_id
        and r.schedule_id = (select schedule_id from public.schedule_revisions where id = p_revision_id)
        and p_revision_id is distinct from s.published_revision_id;
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

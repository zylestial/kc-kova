-- v2.2: "Other" destination and purpose on a request stop, alongside the
-- existing "Other" for Project / Site (0014/0019).
--
-- request_destinations.destination_id/purpose_id become optional: a stop
-- may instead carry free text plus an is_other flag, exactly like
-- requests.project_id/project_name/project_is_other already work.
--
-- The Planner's leg builder (write_revision_content, 0033) matched every
-- leg's destination against an Active booking_options row -- an "Other"
-- destination has none. A leg serving only Other stops now takes its
-- destination from the stops themselves instead, and two Other stops only
-- share a leg when their free text matches exactly (the same rule an id
-- match already enforces for a normal destination).

alter table request_destinations alter column destination_id drop not null;
alter table request_destinations alter column purpose_id drop not null;
alter table request_destinations add column destination_is_other boolean not null default false;
alter table request_destinations add column purpose_is_other boolean not null default false;
alter table request_destinations add constraint request_destinations_destination_other_check
  check (not (destination_is_other and destination_id is not null));
alter table request_destinations add constraint request_destinations_purpose_other_check
  check (not (purpose_is_other and purpose_id is not null));

-- Same shape as insert_request_destinations (0024) plus destinationOther /
-- purposeOther per item. p_kept is only consulted for an id-based choice
-- that has since gone Inactive -- an Other item never depended on an
-- option, so re-submitting its typed text resolves on its own.
create or replace function insert_request_destinations(
  p_request_id uuid,
  p_destinations jsonb,
  p_kept jsonb default '[]'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_position int := 0;
  v_dest_id text;
  v_dest_other text;
  v_dest_name text;
  v_dest_is_other boolean;
  v_purpose_id text;
  v_purpose_other text;
  v_purpose_name text;
  v_purpose_is_other boolean;
begin
  if p_destinations is null or jsonb_typeof(p_destinations) <> 'array'
     or jsonb_array_length(p_destinations) = 0 then
    raise exception 'Add at least one destination' using errcode = '22023';
  end if;
  if jsonb_array_length(p_destinations) > 20 then
    raise exception 'A request can have at most 20 destinations' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_destinations) loop
    v_position := v_position + 1;

    v_dest_id := nullif(v_item ->> 'destinationId', '');
    v_dest_other := coalesce(trim(v_item ->> 'destinationOther'), '');
    if v_dest_id is not null and v_dest_other <> '' then
      raise exception 'Destination %: choose from the list or enter Other, not both', v_position using errcode = '22023';
    end if;
    if v_dest_id is null and v_dest_other = '' then
      raise exception 'Destination % is required', v_position using errcode = '22023';
    end if;
    if v_dest_other <> '' then
      v_dest_name := v_dest_other;
      v_dest_is_other := true;
      v_dest_id := null;
    else
      select name into v_dest_name from public.booking_options
      where "group" = 'destinations' and id = v_dest_id and status = 'Active';
      if v_dest_name is null then
        select k ->> 'destination_name' into v_dest_name
        from jsonb_array_elements(coalesce(p_kept, '[]')) k
        where k ->> 'destination_id' = v_dest_id
        limit 1;
      end if;
      if v_dest_name is null then
        raise exception 'Destination % is not an active option', v_position using errcode = '22023';
      end if;
      v_dest_is_other := false;
    end if;

    v_purpose_id := nullif(v_item ->> 'purposeId', '');
    v_purpose_other := coalesce(trim(v_item ->> 'purposeOther'), '');
    if v_purpose_id is not null and v_purpose_other <> '' then
      raise exception 'Purpose for destination %: choose from the list or enter Other, not both', v_position using errcode = '22023';
    end if;
    if v_purpose_id is null and v_purpose_other = '' then
      raise exception 'Purpose for destination % is required', v_position using errcode = '22023';
    end if;
    if v_purpose_other <> '' then
      v_purpose_name := v_purpose_other;
      v_purpose_is_other := true;
      v_purpose_id := null;
    else
      select name into v_purpose_name from public.booking_options
      where "group" = 'purposes' and id = v_purpose_id and status = 'Active';
      if v_purpose_name is null then
        select k ->> 'purpose_name' into v_purpose_name
        from jsonb_array_elements(coalesce(p_kept, '[]')) k
        where k ->> 'purpose_id' = v_purpose_id
        limit 1;
      end if;
      if v_purpose_name is null then
        raise exception 'Purpose for destination % is not an active option', v_position using errcode = '22023';
      end if;
      v_purpose_is_other := false;
    end if;

    insert into public.request_destinations (
      request_id, position, destination_id, destination_name, destination_is_other,
      purpose_id, purpose_name, purpose_is_other
    ) values (
      p_request_id, v_position, v_dest_id, v_dest_name, v_dest_is_other,
      v_purpose_id, v_purpose_name, v_purpose_is_other
    );
  end loop;
end;
$$;

revoke execute on function insert_request_destinations(uuid, jsonb, jsonb) from public;
revoke execute on function insert_request_destinations(uuid, jsonb, jsonb) from anon;
revoke execute on function insert_request_destinations(uuid, jsonb, jsonb) from authenticated;

-- Same as 0033's write_revision_content, except a leg whose stops are all
-- the same free-text "Other" destination takes its destination from the
-- stops themselves, never from booking_options (there is nothing to match
-- there by design). Mixing an Other stop with a differently-named stop, or
-- with a normal destination, on the same leg is rejected, same as a
-- mismatched destination_id already was.
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

-- A destination or purpose typed under "Other" on a request becomes a
-- request choice (owner's call, 2026-10-09), so nobody types it twice. On
-- submit (insert_request_destinations, used by create and update), a typed
-- name that matches an Active choice in its group (ignoring case and extra
-- spaces) uses that choice; a new name is added as an Active choice and
-- used. A name matching only an Inactive choice stays typed: an Admin
-- retired it on purpose. An Admin can rename, deactivate or set a location
-- on the new choice in Request choices like any other.

-- "  Wilcon   Calasiao " -> "wilcon calasiao", for matching only.
create function option_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

-- The Active choice in p_group named p_name, added when there's no choice
-- of that name at all. Null when only an Inactive one matches. Internal:
-- called by insert_request_destinations, never by clients.
create function choice_for_typed_name(p_group text, p_name text)
returns public.booking_options
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := public.option_name_key(p_name);
  v_option public.booking_options;
begin
  if v_key = '' then
    return null;
  end if;
  -- Two requests typing the same new name at once add it only once.
  perform pg_advisory_xact_lock(hashtext('option:' || p_group || ':' || v_key));

  select * into v_option from public.booking_options
  where "group" = p_group and public.option_name_key(name) = v_key
  order by (status = 'Active') desc
  limit 1;
  if found then
    return case when v_option.status = 'Active' then v_option else null end;
  end if;

  insert into public.booking_options ("group", id, name, status)
  values (p_group, gen_random_uuid()::text, regexp_replace(trim(p_name), '\s+', ' ', 'g'), 'Active')
  returning * into v_option;
  return v_option;
end;
$$;

revoke execute on function choice_for_typed_name(text, text) from public, anon, authenticated;

-- Same as 0036, except a typed destination or purpose goes through
-- choice_for_typed_name first and is stored as that choice when there is
-- one; it stays a typed "Other" only when it matches a retired choice.
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
  v_choice public.booking_options;
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
      v_choice := public.choice_for_typed_name('destinations', v_dest_other);
      if v_choice.id is not null then
        v_dest_id := v_choice.id;
        v_dest_name := v_choice.name;
        v_dest_is_other := false;
      else
        v_dest_name := v_dest_other;
        v_dest_is_other := true;
        v_dest_id := null;
      end if;
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
      v_choice := public.choice_for_typed_name('purposes', v_purpose_other);
      if v_choice.id is not null then
        v_purpose_id := v_choice.id;
        v_purpose_name := v_choice.name;
        v_purpose_is_other := false;
      else
        v_purpose_name := v_purpose_other;
        v_purpose_is_other := true;
        v_purpose_id := null;
      end if;
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

revoke execute on function insert_request_destinations(uuid, jsonb, jsonb) from public, anon, authenticated;

-- Names already typed on requests become choices too (requests keep their
-- typed rows; only new ones link to the choice).
do $$
declare
  v_row record;
begin
  for v_row in
    select distinct 'destinations' as grp, destination_name as name from public.request_destinations where destination_is_other
    union
    select distinct 'purposes', purpose_name from public.request_destinations where purpose_is_other
  loop
    perform public.choice_for_typed_name(v_row.grp, v_row.name);
  end loop;
end;
$$;

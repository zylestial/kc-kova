-- An approximate address for each Start/End tap, so the Admin sees where a
-- tap away from ANONANG was, not only how far. The API route looks it up
-- once at tap time from OpenStreetMap (Nominatim) and passes it in; it is
-- null when the tap has no position or the lookup failed.

alter table trip_attendance
  add column start_address text,
  add column end_address text;

drop function record_trip_attendance(uuid, text, double precision, double precision, double precision);

-- Same as 0042, plus p_address, saved with the tap it belongs to.
create function record_trip_attendance(
  p_schedule_id uuid,
  p_kind text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_address text default null
)
returns public.trip_attendance
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_row public.trip_attendance;
  v_is_override boolean := false;
  v_address text := case when p_lat is null then null else nullif(left(trim(p_address), 300), '') end;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Driver', 'Admin') then
    raise exception 'Driver access required' using errcode = '42501';
  end if;
  if v_actor.role = 'Admin' then
    v_is_override := true;
  end if;

  if p_kind is null or p_kind not in ('START', 'END') then
    raise exception 'Choose Start or End' using errcode = '22023';
  end if;
  if (p_lat is null) <> (p_lng is null)
     or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or p_accuracy_m < 0 then
    raise exception 'That location isn''t valid' using errcode = '22023';
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_revision from public.schedule_revisions
  where id = v_schedule.published_revision_id and status = 'APPROVED';
  if v_revision is null or (v_revision.driver_id <> v_actor.id and not v_is_override) then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_row from public.trip_attendance where schedule_id = p_schedule_id;
  if found and (p_kind = 'START' or v_row.end_at is not null) then
    return v_row;
  end if;

  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This schedule is no longer active' using errcode = '22023';
  end if;
  if exists (select 1 from public.trip_completions where schedule_id = p_schedule_id) then
    raise exception 'This trip has already been submitted' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'attendance.' || lower(p_kind), true);
  if v_is_override then
    perform set_config('kova.audit_is_override', 'true', true);
  end if;

  if p_kind = 'START' then
    if v_schedule.schedule_date > (now() at time zone 'Asia/Manila')::date then
      raise exception 'This trip can''t be started before its date' using errcode = '22023';
    end if;
    insert into public.trip_attendance (
      schedule_id, revision_id, driver_id,
      start_lat, start_lng, start_accuracy_m, start_distance_m, start_address, start_recorded_by_account_id
    ) values (
      p_schedule_id, v_revision.id, v_revision.driver_id,
      p_lat, p_lng, p_accuracy_m, public.distance_from_base_m(p_lat, p_lng), v_address, v_actor.id
    )
    returning * into v_row;
  else
    if v_row.id is null then
      raise exception 'Start the trip before ending it' using errcode = '22023';
    end if;
    update public.trip_attendance set
      end_at = now(),
      end_lat = p_lat,
      end_lng = p_lng,
      end_accuracy_m = p_accuracy_m,
      end_distance_m = public.distance_from_base_m(p_lat, p_lng),
      end_address = v_address,
      end_recorded_by_account_id = v_actor.id
    where id = v_row.id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke execute on function record_trip_attendance(uuid, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function record_trip_attendance(uuid, text, double precision, double precision, double precision, text) to authenticated;

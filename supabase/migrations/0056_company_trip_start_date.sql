-- A Company trip can't be started before its date, as a Daily trip's Start
-- trip can't (0042). My Trips already only offers Start trip from the
-- trip's date (Asia/Manila); this enforces it. Otherwise the same as 0055.
create or replace function start_company_trip(
  p_schedule_id uuid,
  p_odometer integer,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_address text default null
)
returns public.company_trip_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_revision public.schedule_revisions;
  v_run public.company_trip_runs;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  v_revision := public.company_trip_for_recording(p_schedule_id, v_actor);
  select * into v_run from public.company_trip_runs where schedule_id = p_schedule_id;
  if found then
    return v_run;
  end if;
  if (select schedule_date from public.schedules where id = p_schedule_id) > (now() at time zone 'Asia/Manila')::date then
    raise exception 'This trip can''t be started before its date' using errcode = '22023';
  end if;
  if p_odometer is null or p_odometer < 0 then
    raise exception 'Enter the starting odometer reading, in whole kilometres' using errcode = '22023';
  end if;
  perform public.check_tap_location(p_lat, p_lng, p_accuracy_m);

  perform set_config('kova.audit_action', 'company_trip.start', true);
  insert into public.company_trip_runs (
    schedule_id, revision_id, start_odometer, start_lat, start_lng, start_accuracy_m, start_address, started_by_account_id
  ) values (
    p_schedule_id, v_revision.id, p_odometer, p_lat, p_lng, p_accuracy_m,
    case when p_lat is null then null else nullif(left(trim(p_address), 300), '') end, v_actor.id
  ) returning * into v_run;
  return v_run;
end;
$$;

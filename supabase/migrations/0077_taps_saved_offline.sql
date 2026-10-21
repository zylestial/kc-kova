-- Taps saved on the phone without signal (2026-10-21). A Driver in a dead
-- zone taps Start trip, Arrived, Leaving or End trip; the phone keeps the
-- tap with the time it was made and sends it once there's signal. Until
-- now every tap took the server's time on arrival, so a tap sent late read
-- late.
--
-- Each tap RPC gets an "_at" twin that takes the phone's time: it sets
-- kova.tapped_at for the call, runs the RPC as before (same checks, same
-- repeats), and the trigger below puts that time on the row instead of
-- the server's. The phone's clock is trusted only within bounds: never
-- after the server's now, and never before the step it follows (the trip
-- day's midnight for Start, the trip's start or last stop tap for a stop,
-- its start or last stop tap for End). A row given the phone's time also
-- records when the server got it (sent_at), so a tap sent late can be
-- told apart.

alter table stop_taps add column sent_at timestamptz;
alter table trip_attendance add column start_sent_at timestamptz, add column end_sent_at timestamptz;
alter table company_trip_runs add column start_sent_at timestamptz, add column end_sent_at timestamptz;

comment on column stop_taps.sent_at is 'When the server got a tap saved on the phone (0077); null when it arrived as tapped.';
comment on column trip_attendance.start_sent_at is 'When the server got a Start trip saved on the phone (0077).';
comment on column trip_attendance.end_sent_at is 'When the server got an End trip saved on the phone (0077).';
comment on column company_trip_runs.start_sent_at is 'When the server got a Start trip saved on the phone (0077).';
comment on column company_trip_runs.end_sent_at is 'When the server got an End trip saved on the phone (0077).';

-- The phone's time, kept between the step before and now.
create function bounded_tap_time(p_tapped timestamptz, p_floor timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(p_floor, least(p_tapped, now()));
$$;

revoke execute on function bounded_tap_time(timestamptz, timestamptz) from public, anon, authenticated;

create function apply_tapped_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tapped timestamptz := nullif(current_setting('kova.tapped_at', true), '')::timestamptz;
  v_last_stop timestamptz;
begin
  if v_tapped is null then
    return new;
  end if;

  select max(at) into v_last_stop from public.stop_taps where schedule_id = new.schedule_id;

  if tg_table_name = 'stop_taps' then
    new.at := public.bounded_tap_time(v_tapped, greatest(
      (select start_at from public.trip_attendance where schedule_id = new.schedule_id),
      (select start_at from public.company_trip_runs where schedule_id = new.schedule_id),
      v_last_stop
    ));
    new.sent_at := now();
  elsif tg_op = 'INSERT' then
    new.start_at := public.bounded_tap_time(v_tapped,
      (select schedule_date::timestamp at time zone 'Asia/Manila' from public.schedules where id = new.schedule_id));
    new.start_sent_at := now();
  elsif old.end_at is null and new.end_at is not null then
    new.end_at := public.bounded_tap_time(v_tapped, greatest(old.start_at, v_last_stop));
    new.end_sent_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function apply_tapped_at() from public, anon, authenticated;

create trigger stop_taps_tapped_at
  before insert on stop_taps
  for each row execute function apply_tapped_at();
create trigger trip_attendance_tapped_at
  before insert or update on trip_attendance
  for each row execute function apply_tapped_at();
create trigger company_trip_runs_tapped_at
  before insert or update on company_trip_runs
  for each row execute function apply_tapped_at();

-- The "_at" twins. Invoker rights: each calls the RPC it wraps, which
-- checks who may tap exactly as before.

create function record_trip_attendance_at(
  p_tapped_at timestamptz,
  p_schedule_id uuid,
  p_kind text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_address text default null
)
returns public.trip_attendance
language plpgsql
set search_path = ''
as $$
declare
  v_row public.trip_attendance;
begin
  if p_tapped_at is null then
    raise exception 'The tap has no time' using errcode = '22023';
  end if;
  perform set_config('kova.tapped_at', p_tapped_at::text, true);
  v_row := public.record_trip_attendance(p_schedule_id, p_kind, p_lat, p_lng, p_accuracy_m, p_address);
  perform set_config('kova.tapped_at', '', true);
  return v_row;
end;
$$;

create function record_stop_tap_at(
  p_tapped_at timestamptz,
  p_schedule_id uuid,
  p_leg_id uuid,
  p_kind text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_address text default null
)
returns public.stop_taps
language plpgsql
set search_path = ''
as $$
declare
  v_row public.stop_taps;
begin
  if p_tapped_at is null then
    raise exception 'The tap has no time' using errcode = '22023';
  end if;
  perform set_config('kova.tapped_at', p_tapped_at::text, true);
  v_row := public.record_stop_tap(p_schedule_id, p_leg_id, p_kind, p_lat, p_lng, p_accuracy_m, p_address);
  perform set_config('kova.tapped_at', '', true);
  return v_row;
end;
$$;

create function record_company_stop_at(
  p_tapped_at timestamptz,
  p_schedule_id uuid,
  p_leg_id uuid,
  p_kind text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_address text default null
)
returns public.stop_taps
language plpgsql
set search_path = ''
as $$
declare
  v_row public.stop_taps;
begin
  if p_tapped_at is null then
    raise exception 'The tap has no time' using errcode = '22023';
  end if;
  perform set_config('kova.tapped_at', p_tapped_at::text, true);
  v_row := public.record_company_stop(p_schedule_id, p_leg_id, p_kind, p_lat, p_lng, p_accuracy_m, p_address);
  perform set_config('kova.tapped_at', '', true);
  return v_row;
end;
$$;

create function start_company_trip_at(
  p_tapped_at timestamptz,
  p_schedule_id uuid,
  p_odometer integer,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_address text default null
)
returns public.company_trip_runs
language plpgsql
set search_path = ''
as $$
declare
  v_row public.company_trip_runs;
begin
  if p_tapped_at is null then
    raise exception 'The tap has no time' using errcode = '22023';
  end if;
  perform set_config('kova.tapped_at', p_tapped_at::text, true);
  v_row := public.start_company_trip(p_schedule_id, p_odometer, p_lat, p_lng, p_accuracy_m, p_address);
  perform set_config('kova.tapped_at', '', true);
  return v_row;
end;
$$;

create function end_company_trip_at(
  p_tapped_at timestamptz,
  p_schedule_id uuid,
  p_odometer integer,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null,
  p_address text default null
)
returns public.company_trip_runs
language plpgsql
set search_path = ''
as $$
declare
  v_row public.company_trip_runs;
begin
  if p_tapped_at is null then
    raise exception 'The tap has no time' using errcode = '22023';
  end if;
  perform set_config('kova.tapped_at', p_tapped_at::text, true);
  v_row := public.end_company_trip(p_schedule_id, p_odometer, p_lat, p_lng, p_accuracy_m, p_address);
  perform set_config('kova.tapped_at', '', true);
  return v_row;
end;
$$;

revoke execute on function record_trip_attendance_at(timestamptz, uuid, text, double precision, double precision, double precision, text) from public, anon;
revoke execute on function record_stop_tap_at(timestamptz, uuid, uuid, text, double precision, double precision, double precision, text) from public, anon;
revoke execute on function record_company_stop_at(timestamptz, uuid, uuid, text, double precision, double precision, double precision, text) from public, anon;
revoke execute on function start_company_trip_at(timestamptz, uuid, integer, double precision, double precision, double precision, text) from public, anon;
revoke execute on function end_company_trip_at(timestamptz, uuid, integer, double precision, double precision, double precision, text) from public, anon;
grant execute on function record_trip_attendance_at(timestamptz, uuid, text, double precision, double precision, double precision, text) to authenticated;
grant execute on function record_stop_tap_at(timestamptz, uuid, uuid, text, double precision, double precision, double precision, text) to authenticated;
grant execute on function record_company_stop_at(timestamptz, uuid, uuid, text, double precision, double precision, double precision, text) to authenticated;
grant execute on function start_company_trip_at(timestamptz, uuid, integer, double precision, double precision, double precision, text) to authenticated;
grant execute on function end_company_trip_at(timestamptz, uuid, integer, double precision, double precision, double precision, text) to authenticated;

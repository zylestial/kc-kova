-- Stop times: a destination can have a saved position, so a Driver's
-- Arrived/Leaving tap there can be checked against it, the way Start/End
-- taps are checked against ANONANG. Optional: a destination without one
-- (and every "other" typed-in destination) still takes taps, unchecked.
-- Admin sets it on Request choices.
--
-- Its own table, not lat/lng columns on booking_options: functions such as
-- resolve_request_project test a fetched option with `v_option is not null`,
-- which for a row is true only when every column is non-null, so a nullable
-- column there would make every option look missing.

create table destination_locations (
  destination_group text not null default 'destinations' check (destination_group = 'destinations'),
  destination_id text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  primary key (destination_group, destination_id),
  foreign key (destination_group, destination_id) references booking_options ("group", id)
);

create trigger destination_locations_audit
  after insert or update or delete on destination_locations
  for each row execute function write_audit_event();

alter table destination_locations enable row level security;

grant select, insert, update, delete on destination_locations to authenticated;

-- Same as booking_options: everyone signed in reads, only Admin writes.
create policy destination_locations_select on destination_locations for select
  using ((select auth.role()) = 'authenticated');
create policy destination_locations_admin_insert on destination_locations for insert
  with check (is_admin((select auth.uid())));
create policy destination_locations_admin_update on destination_locations for update
  using (is_admin((select auth.uid())))
  with check (is_admin((select auth.uid())));
create policy destination_locations_admin_delete on destination_locations for delete
  using (is_admin((select auth.uid())));

-- Metres between two points, by the haversine formula (the same sum as
-- distance_from_base_m, for any two points). Null when either is missing.
create function distance_m(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null else
    2 * 6371000 * asin(sqrt(
      power(sin(radians(p_lat1 - p_lat2) / 2), 2)
      + cos(radians(p_lat2)) * cos(radians(p_lat1)) * power(sin(radians(p_lng1 - p_lng2) / 2), 2)
    ))
  end;
$$;

revoke execute on function distance_m(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function distance_m(double precision, double precision, double precision, double precision) to authenticated;

-- Stop times: a destination can have a saved position, so a Driver's
-- Arrived/Leaving tap there can be checked against it, the way Start/End
-- taps are checked against ANONANG. Optional: a destination without one
-- (and every "other" typed-in destination) still takes taps, unchecked.
-- Only destinations have a position; Admin sets it on Request choices.

alter table booking_options
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add constraint booking_options_lat_lng_together check ((lat is null) = (lng is null)),
  add constraint booking_options_location_destinations_only check (lat is null or "group" = 'destinations');

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

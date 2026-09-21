-- Indexes for every foreign key and every column an RLS policy filters on.
-- Postgres does not auto-index the referencing side of a foreign key, and
-- an RLS predicate runs on every row a query would otherwise scan, so both
-- are worth covering explicitly. Purely additive (CREATE INDEX doesn't
-- change what any query returns), so this carries no behavior risk.

-- bookings: driver_id/requested_by_account_id/created_by_account_id are FKs
-- to accounts and are also the exact columns bookings_select's RLS
-- predicate filters on (0007_rls_policies_per_operation.sql).
create index if not exists bookings_driver_id_idx on bookings (driver_id);
create index if not exists bookings_requested_by_account_id_idx on bookings (requested_by_account_id);
create index if not exists bookings_created_by_account_id_idx on bookings (created_by_account_id);
-- plate is an FK to vehicles and is rewritten in bulk by rename_vehicle.
create index if not exists bookings_plate_idx on bookings (plate);

-- booking_slots.booking_id is an FK (on delete cascade) with no covering
-- index, so every booking cancel/delete does a sequential scan to find the
-- slots to remove.
create index if not exists booking_slots_booking_id_idx on booking_slots (booking_id);

-- people.account_id is an FK to accounts.
create index if not exists people_account_id_idx on people (account_id);

-- vehicle_aliases.new_plate is an FK to vehicles.
create index if not exists vehicle_aliases_new_plate_idx on vehicle_aliases (new_plate);

-- vehicle_records: (data->>'bookingId')::uuid is what vehicle_records_select's
-- RLS predicate and the booking-lock checks in create_booking/update_booking/
-- cancel_booking both filter on; without this, every one of those is a
-- sequential scan with a per-row jsonb extraction.
create index if not exists vehicle_records_booking_id_idx
  on vehicle_records (((data->>'bookingId')::uuid));

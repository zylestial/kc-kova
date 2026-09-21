-- KOVA core schema.
--
-- accounts.id is the same uuid as the corresponding auth.users row; Accounts
-- are provisioned by an Admin through the service-role client, which creates
-- the auth user and this profile row together. There is no public sign-up.

create extension if not exists pgcrypto;

create table accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  name text not null,
  role text not null check (role in ('Booker', 'Driver', 'Admin')),
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  project text,
  created_at timestamptz not null default now()
);

-- Helper used by RLS policies below. security definer so it can read
-- accounts regardless of the caller's own row-level access.
create function is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from accounts
    where id = uid and role = 'Admin' and status = 'Active'
  );
$$;

create table vehicles (
  plate text primary key,
  name text not null,
  status text not null default 'Active' check (status in ('Active', 'Inactive'))
);

create table vehicle_aliases (
  old_plate text primary key,
  new_plate text not null references vehicles (plate)
);

create table booking_options (
  "group" text not null check ("group" in ('projects', 'destinations', 'purposes')),
  id text not null,
  name text not null,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  primary key ("group", id)
);

create table people (
  id text primary key,
  name text not null,
  project_ids text[] not null default '{}',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  account_id uuid references accounts (id)
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  plate text not null references vehicles (plate),
  start_hour smallint not null check (start_hour >= 0 and start_hour < 24),
  end_hour smallint not null check (end_hour > start_hour and end_hour <= 24),
  driver_id uuid not null references accounts (id),
  driver_name text not null,
  project text not null default '',
  requested_by_account_id uuid not null references accounts (id),
  requested_by_name text not null,
  destination text not null,
  purpose text not null,
  notes text not null default '',
  created_by_account_id uuid not null references accounts (id),
  created_at timestamptz not null default now(),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'CANCELLED'))
);

-- One row per hour of an active booking; the two unique indexes are what make
-- vehicle/driver double-booking impossible even under concurrent inserts.
-- Rows exist only while the owning booking is SCHEDULED.
create table booking_slots (
  booking_id uuid not null references bookings (id) on delete cascade,
  date date not null,
  plate text not null,
  driver_id uuid not null,
  hour smallint not null,
  unique (date, plate, hour),
  unique (date, driver_id, hour)
);

-- One record per vehicle per day: every booking for that vehicle that day
-- must share the same driver (enforced by trigger below), so a single daily
-- form covers all of that vehicle's trips.
create table vehicle_records (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  plate text not null,
  data jsonb not null,
  unique (date, plate)
);

create function enforce_same_daily_driver()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from bookings
    where date = new.date
      and plate = new.plate
      and status = 'SCHEDULED'
      and driver_id <> new.driver_id
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Vehicle already has a different driver scheduled that day';
  end if;
  return new;
end;
$$;

create trigger same_vehicle_daily_driver
  before insert or update on bookings
  for each row
  when (new.status = 'SCHEDULED')
  execute function enforce_same_daily_driver();

create function block_inactive_vehicle()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from vehicles where plate = new.plate and status = 'Inactive') then
    raise exception 'Vehicle is inactive';
  end if;
  return new;
end;
$$;

create trigger block_inactive_vehicle_on_booking
  before insert on bookings
  for each row
  execute function block_inactive_vehicle();

create table login_attempts (
  key text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);

alter table accounts enable row level security;
alter table vehicles enable row level security;
alter table vehicle_aliases enable row level security;
alter table booking_options enable row level security;
alter table people enable row level security;
alter table bookings enable row level security;
alter table booking_slots enable row level security;
alter table vehicle_records enable row level security;
alter table login_attempts enable row level security;

-- accounts: any signed-in user can read the roster (needed to show Driver
-- names when booking); only Admin manages accounts.
create policy accounts_select on accounts for select
  using (auth.role() = 'authenticated');
create policy accounts_admin_write on accounts for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- vehicles / vehicle_aliases / booking_options / people: read-only reference
-- data for any signed-in user, Admin-managed.
create policy vehicles_select on vehicles for select
  using (auth.role() = 'authenticated');
create policy vehicles_admin_write on vehicles for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create policy vehicle_aliases_select on vehicle_aliases for select
  using (auth.role() = 'authenticated');
create policy vehicle_aliases_admin_write on vehicle_aliases for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create policy booking_options_select on booking_options for select
  using (auth.role() = 'authenticated');
create policy booking_options_admin_write on booking_options for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create policy people_select on people for select
  using (auth.role() = 'authenticated');
create policy people_admin_write on people for all
  using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- bookings: Drivers see only bookings assigned to them; Booker/Admin see all.
-- Writes (insert/update/delete) go through the RPC functions added in a
-- follow-up migration, which run as the table owner and enforce ownership,
-- conflict and lock rules atomically; direct table writes are not granted.
create policy bookings_select on bookings for select
  using (
    driver_id = auth.uid()
    or requested_by_account_id = auth.uid()
    or created_by_account_id = auth.uid()
    or exists (
      select 1 from accounts
      where id = auth.uid() and role in ('Booker', 'Admin') and status = 'Active'
    )
  );

-- booking_slots is an internal conflict-tracking table only touched by the
-- booking RPC functions; no direct client policies are granted.

-- vehicle_records: a Driver sees only their own bookings' records; Booker
-- sees records for bookings they created; Admin sees all. Writes go through
-- RPC functions added in a follow-up migration.
create policy vehicle_records_select on vehicle_records for select
  using (
    exists (
      select 1 from bookings b
      where b.id = (data->>'bookingId')::uuid
        and (
          b.driver_id = auth.uid()
          or b.created_by_account_id = auth.uid()
          or exists (
            select 1 from accounts
            where id = auth.uid() and role = 'Admin' and status = 'Active'
          )
        )
    )
  );

-- login_attempts is only ever touched by server code using the service-role
-- client; no policies are granted to authenticated/anon roles.

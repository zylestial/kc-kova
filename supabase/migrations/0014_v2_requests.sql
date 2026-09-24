-- v2.0 transport requests.
--
-- A Requester (or Admin) asks for transport on one date, with one or more
-- destinations, each with its own purpose. No vehicle, Driver or time is
-- chosen here -- a Scheduler assigns those later by including the request
-- in a schedule (0015_v2_schedules.sql).
--
-- Names are snapshotted alongside option ids so a request keeps showing
-- what was chosen even after an option is renamed or made Inactive.
--
-- Writes are RPC-only (0018_v2_request_rpcs.sql); authenticated gets
-- SELECT and nothing else, same pattern as bookings.

create table requests (
  id uuid primary key default gen_random_uuid(),
  owner_account_id uuid not null references accounts (id),
  owner_name text not null,
  requested_date date not null,
  request_type text not null check (request_type in ('REGULAR', 'URGENT')),
  -- Project / Site: an option id + name snapshot, or free "Other" text, or
  -- neither (the field is optional).
  project_id text,
  project_name text not null default '',
  project_is_other boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED')),
  cancelled_at timestamptz,
  cancelled_by_account_id uuid references accounts (id),
  -- Bumped on every edit; update_request compares it so a stale open form
  -- can't silently overwrite a newer change.
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not (project_is_other and project_id is not null)),
  check ((status = 'CANCELLED') = (cancelled_at is not null))
);

create index requests_owner_account_id_idx on requests (owner_account_id);
create index requests_requested_date_idx on requests (requested_date);
create index requests_cancelled_by_account_id_idx on requests (cancelled_by_account_id);

-- Destinations are never deleted: an edit marks the old rows inactive and
-- inserts new ones, because leg stops on past (discarded or superseded)
-- schedule revisions may still reference the old rows.
create table request_destinations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests (id),
  position smallint not null check (position >= 1),
  destination_id text not null,
  destination_name text not null,
  purpose_id text not null,
  purpose_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index request_destinations_active_position_unique
  on request_destinations (request_id, position)
  where active;
create index request_destinations_request_id_idx on request_destinations (request_id);

-- A Requester asking to cancel a request that is already in a schedule.
-- The schedule stays in effect while this is PENDING; an Admin confirms or
-- declines it (Phase 7). Unscheduled requests are cancelled directly on
-- the request row instead and never create one of these.
create table request_cancellations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests (id),
  requested_by_account_id uuid not null references accounts (id),
  requested_at timestamptz not null default now(),
  reason text not null default '',
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'DECLINED')),
  decided_by_account_id uuid references accounts (id),
  decided_at timestamptz,
  decision_note text not null default '',
  check ((status = 'PENDING') = (decided_at is null))
);

create unique index request_cancellations_one_pending
  on request_cancellations (request_id)
  where status = 'PENDING';
create index request_cancellations_request_id_idx on request_cancellations (request_id);
create index request_cancellations_requested_by_idx on request_cancellations (requested_by_account_id);
create index request_cancellations_decided_by_idx on request_cancellations (decided_by_account_id);

alter table requests enable row level security;
alter table request_destinations enable row level security;
alter table request_cancellations enable row level security;

grant select on requests, request_destinations, request_cancellations to authenticated;

-- Read access. Owners see their own requests; Admin and Scheduler see all
-- (the Scheduler's request pool, plus cancelled ones so past schedules
-- still read correctly). Driver visibility of requests on their own
-- approved schedules is added in 0015, once schedules exist. Requesters
-- never see each other's requests. request_destinations piggybacks on the
-- requests policy: the subquery below is itself filtered by it.
create policy requests_select on requests for select
  using (
    owner_account_id = (select auth.uid())
    or (select current_account_role()) = 'Admin'
    or (select current_account_role()) = 'Scheduler'
  );

create policy request_destinations_select on request_destinations for select
  using (
    exists (select 1 from requests r where r.id = request_id)
  );

create policy request_cancellations_select on request_cancellations for select
  using (
    requested_by_account_id = (select auth.uid())
    or (select current_account_role()) = 'Admin'
  );

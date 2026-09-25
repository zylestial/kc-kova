-- v2.0 schedules, revisions, Trip Record legs and reservations.
--
-- A schedule is one vehicle's trip on one date, built by a Scheduler from
-- one or more requests. Its content lives in numbered revisions: v1 is the
-- first draft, and once a revision is approved (published) any later change
-- is a new proposed revision that sits beside the published one until an
-- Admin approves it. The published revision and its reservation stay in
-- force the whole time a proposal is pending.
--
-- Revision status:  DRAFT -> SUBMITTED -> APPROVED -> SUPERSEDED
--                     ^          |
--                     +- RETURNED
--                   DRAFT/RETURNED -> DISCARDED
-- At most one "open" (DRAFT/SUBMITTED/RETURNED) and one APPROVED revision
-- per schedule at any time. Closed revisions are immutable (trigger below).
--
-- Reservations: one row per live revision, covering the vehicle and Driver
-- from the first leg's planned Time Out to the last leg's planned Time In,
-- at minute precision (docs/MEMORY.md, "Phase 3 design decisions").
-- Exclusion constraints make overlapping reservations for the same
-- vehicle or Driver impossible, including under concurrent writes, except
-- between two revisions of the same schedule (a pending proposal must not
-- conflict with the version it would replace).
--
-- Writes are RPC-only (0019_v2_schedule_rpcs.sql); authenticated gets
-- SELECT only.

create extension if not exists btree_gist with schema extensions;

create table schedules (
  id uuid primary key default gen_random_uuid(),
  schedule_date date not null,
  created_by_account_id uuid not null references accounts (id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISCARDED', 'CANCELLED')),
  published_revision_id uuid,
  cancelled_at timestamptz,
  cancelled_by_account_id uuid references accounts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index schedules_schedule_date_idx on schedules (schedule_date);
create index schedules_created_by_idx on schedules (created_by_account_id);
create index schedules_cancelled_by_idx on schedules (cancelled_by_account_id);

create table schedule_revisions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references schedules (id),
  version integer not null check (version >= 1),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'SUPERSEDED', 'DISCARDED')),
  plate text not null references vehicles (plate),
  driver_id uuid not null references accounts (id),
  driver_name text not null,
  -- Bumped on every save; RPCs compare it so two people editing the same
  -- draft can't silently overwrite each other.
  row_version integer not null default 1,
  created_by_account_id uuid not null references accounts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  submitted_by_account_id uuid references accounts (id),
  decided_at timestamptz,
  decided_by_account_id uuid references accounts (id),
  decision_comment text not null default '',
  unique (schedule_id, version)
);

create unique index schedule_revisions_one_open
  on schedule_revisions (schedule_id)
  where status in ('DRAFT', 'SUBMITTED', 'RETURNED');
create unique index schedule_revisions_one_approved
  on schedule_revisions (schedule_id)
  where status = 'APPROVED';
create index schedule_revisions_plate_idx on schedule_revisions (plate);
create index schedule_revisions_driver_id_idx on schedule_revisions (driver_id);
create index schedule_revisions_created_by_idx on schedule_revisions (created_by_account_id);
create index schedule_revisions_submitted_by_idx on schedule_revisions (submitted_by_account_id);
create index schedule_revisions_decided_by_idx on schedule_revisions (decided_by_account_id);

alter table schedules
  add constraint schedules_published_revision_fk
  foreign key (published_revision_id) references schedule_revisions (id);
create index schedules_published_revision_idx on schedules (published_revision_id);

-- Which requests a revision serves.
create table revision_requests (
  revision_id uuid not null references schedule_revisions (id),
  request_id uuid not null references requests (id),
  primary key (revision_id, request_id)
);

create index revision_requests_request_id_idx on revision_requests (request_id);

-- Schedule-level inclusion: an active row locks the request against edits
-- and against inclusion in any other schedule. A request is included
-- while it appears in the schedule's published or open revision; rows are
-- released (never deleted) when that stops being true, so the history of
-- which schedules a request passed through survives.
create table schedule_requests (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references schedules (id),
  request_id uuid not null references requests (id),
  active boolean not null default true,
  included_at timestamptz not null default now(),
  included_by_account_id uuid not null references accounts (id),
  released_at timestamptz,
  released_by_account_id uuid references accounts (id),
  check (active = (released_at is null))
);

create unique index schedule_requests_one_active
  on schedule_requests (request_id)
  where active;
create index schedule_requests_schedule_id_idx on schedule_requests (schedule_id);
create index schedule_requests_request_id_idx on schedule_requests (request_id);
create index schedule_requests_included_by_idx on schedule_requests (included_by_account_id);
create index schedule_requests_released_by_idx on schedule_requests (released_by_account_id);

-- Trip Record legs. Route rules (start at ANONANG, each origin = previous
-- destination, single final leg back to ANONANG) are validated by the
-- schedule RPCs; the constraints here are the ones a single row can check.
create table schedule_legs (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references schedule_revisions (id),
  leg_no smallint not null check (leg_no >= 1),
  origin text not null,
  destination_id text,
  destination_name text not null,
  planned_time_out time(0) not null,
  planned_time_in time(0) not null,
  contact_name text not null default '',
  contact_number text not null default '',
  is_final boolean not null default false,
  unique (revision_id, leg_no),
  unique (id, revision_id),
  check (planned_time_in > planned_time_out),
  check (extract(second from planned_time_out) = 0 and extract(second from planned_time_in) = 0),
  check (not is_final or destination_name = 'ANONANG')
);

create unique index schedule_legs_one_final
  on schedule_legs (revision_id)
  where is_final;

-- Leg <-> request-destination mapping. A shared stop is one leg with
-- several rows here, each keeping its own requester and purpose. Each
-- request destination is served by exactly one leg per revision.
create table leg_stops (
  leg_id uuid not null,
  revision_id uuid not null,
  request_destination_id uuid not null references request_destinations (id),
  primary key (leg_id, request_destination_id),
  unique (revision_id, request_destination_id),
  foreign key (leg_id, revision_id) references schedule_legs (id, revision_id) on delete cascade
);

create index leg_stops_revision_id_idx on leg_stops (revision_id);
create index leg_stops_request_destination_id_idx on leg_stops (request_destination_id);

create table schedule_reservations (
  revision_id uuid primary key references schedule_revisions (id),
  schedule_id uuid not null references schedules (id),
  plate text not null references vehicles (plate),
  driver_id uuid not null references accounts (id),
  period tstzrange not null check (not isempty(period)),
  constraint schedule_reservations_vehicle_overlap
    exclude using gist (plate with =, period with &&, schedule_id with <>),
  constraint schedule_reservations_driver_overlap
    exclude using gist (driver_id with =, period with &&, schedule_id with <>)
);

create index schedule_reservations_schedule_id_idx on schedule_reservations (schedule_id);
create index schedule_reservations_driver_id_idx on schedule_reservations (driver_id);

-- Closed revisions (APPROVED, SUPERSEDED, DISCARDED) are history: their
-- legs, stops and request list can't change. Guards against a future RPC
-- bug quietly rewriting an approved route.
create function prevent_closed_revision_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_revision_id uuid;
begin
  v_revision_id := case when tg_op = 'DELETE' then old.revision_id else new.revision_id end;
  if exists (
    select 1 from public.schedule_revisions
    where id = v_revision_id and status not in ('DRAFT', 'SUBMITTED', 'RETURNED')
  ) then
    raise exception 'This schedule version is closed and cannot be changed' using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger schedule_legs_closed_revision
  before insert or update or delete on schedule_legs
  for each row execute function prevent_closed_revision_changes();
create trigger leg_stops_closed_revision
  before insert or update or delete on leg_stops
  for each row execute function prevent_closed_revision_changes();
create trigger revision_requests_closed_revision
  before insert or update or delete on revision_requests
  for each row execute function prevent_closed_revision_changes();

-- Visibility helpers. security definer so the checks can read across
-- tables regardless of the caller's own row access.
--
-- A schedule is visible to Admin and Scheduler always; to its assigned
-- Driver and to owners of its requests only once a revision is published,
-- and then only that published revision -- never a draft or proposal.
create function can_view_revision(p_revision_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select public.current_account_role()) in ('Admin', 'Scheduler')
    or exists (
      select 1
      from public.schedule_revisions sr
      join public.schedules s on s.published_revision_id = sr.id
      where sr.id = p_revision_id
        and (
          sr.driver_id = (select auth.uid())
          or exists (
            select 1 from public.revision_requests rr
            join public.requests r on r.id = rr.request_id
            where rr.revision_id = sr.id and r.owner_account_id = (select auth.uid())
          )
        )
    );
$$;

create function can_view_schedule(p_schedule_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select public.current_account_role()) in ('Admin', 'Scheduler')
    or exists (
      select 1 from public.schedules s
      where s.id = p_schedule_id and public.can_view_revision(s.published_revision_id)
    );
$$;

-- True when the caller owns the request, or is its Driver on a published
-- schedule. Requesters sharing a schedule must not see each other's
-- requests, purposes or stops.
create function can_view_request_details(p_request_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select
    (select public.current_account_role()) in ('Admin', 'Scheduler')
    or exists (
      select 1 from public.requests r
      where r.id = p_request_id and r.owner_account_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.revision_requests rr
      join public.schedules s on s.published_revision_id = rr.revision_id
      join public.schedule_revisions sr on sr.id = rr.revision_id
      where rr.request_id = p_request_id and sr.driver_id = (select auth.uid())
    );
$$;

revoke execute on function can_view_revision(uuid) from public;
revoke execute on function can_view_revision(uuid) from anon;
grant execute on function can_view_revision(uuid) to authenticated;
revoke execute on function can_view_schedule(uuid) from public;
revoke execute on function can_view_schedule(uuid) from anon;
grant execute on function can_view_schedule(uuid) to authenticated;
revoke execute on function can_view_request_details(uuid) from public;
revoke execute on function can_view_request_details(uuid) from anon;
grant execute on function can_view_request_details(uuid) to authenticated;

alter table schedules enable row level security;
alter table schedule_revisions enable row level security;
alter table revision_requests enable row level security;
alter table schedule_requests enable row level security;
alter table schedule_legs enable row level security;
alter table leg_stops enable row level security;
alter table schedule_reservations enable row level security;

grant select on
  schedules, schedule_revisions, revision_requests, schedule_requests,
  schedule_legs, leg_stops, schedule_reservations
to authenticated;

create policy schedules_select on schedules for select
  using (can_view_schedule(id));

create policy schedule_revisions_select on schedule_revisions for select
  using (can_view_revision(id));

create policy schedule_legs_select on schedule_legs for select
  using (can_view_revision(revision_id));

create policy revision_requests_select on revision_requests for select
  using (can_view_revision(revision_id) and can_view_request_details(request_id));

create policy leg_stops_select on leg_stops for select
  using (
    can_view_revision(revision_id)
    and exists (
      select 1 from request_destinations rd
      where rd.id = request_destination_id and can_view_request_details(rd.request_id)
    )
  );

-- Inclusion history drives a request's progress label, so its owner sees
-- it too.
create policy schedule_requests_select on schedule_requests for select
  using (can_view_request_details(request_id));

-- Existing commitments, for weekly planning. Not exposed to Requester or
-- Driver: their view is the published revision itself.
create policy schedule_reservations_select on schedule_reservations for select
  using ((select current_account_role()) in ('Admin', 'Scheduler'));

-- Requests: also visible to the Driver of a published schedule that serves
-- them, so the Driver sees each stop's requester and purpose.
drop policy requests_select on requests;
create policy requests_select on requests for select
  using (can_view_request_details(id));

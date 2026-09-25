-- v2.0 trip completion and problem reports.
--
-- Completion: the Driver confirms the whole schedule is done and enters one
-- starting/ending odometer pair for it (not per request or per leg). It
-- pins the exact approved revision it completes, so a later revision can
-- never re-point it. submitted_at is always server time. Once a completion
-- exists the schedule can't be revised; once it is DONE the record is
-- locked for everyone. Admin corrections go through audit history.
--
-- Problem report: a short note from the Driver when a trip can't be
-- completed as planned. It doesn't claim completion or require odometers.
-- An Admin reviews it; any follow-up schedule is linked back to it
-- (Phase 8).
--
-- Legacy v1.2 Daily Vehicle Records stay in vehicle_records untouched,
-- including their Finance fields; v2 adds no digital Finance entry.
--
-- Writes are RPC-only (Phase 8); authenticated gets SELECT only.

create table trip_completions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null unique references schedules (id),
  revision_id uuid not null references schedule_revisions (id),
  driver_id uuid not null references accounts (id),
  start_odometer integer not null check (start_odometer >= 0),
  end_odometer integer not null,
  distance integer generated always as (end_odometer - start_odometer) stored,
  submitted_at timestamptz not null default now(),
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'DONE')),
  done_at timestamptz,
  done_by_account_id uuid references accounts (id),
  check (end_odometer >= start_odometer),
  check ((status = 'DONE') = (done_at is not null))
);

create index trip_completions_revision_id_idx on trip_completions (revision_id);
create index trip_completions_driver_id_idx on trip_completions (driver_id);
create index trip_completions_done_by_idx on trip_completions (done_by_account_id);

create table problem_reports (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references schedules (id),
  revision_id uuid not null references schedule_revisions (id),
  driver_id uuid not null references accounts (id),
  note text not null check (length(trim(note)) > 0),
  created_at timestamptz not null default now(),
  status text not null default 'OPEN' check (status in ('OPEN', 'HANDLED')),
  handled_at timestamptz,
  handled_by_account_id uuid references accounts (id),
  handling_note text not null default '',
  check ((status = 'HANDLED') = (handled_at is not null))
);

create index problem_reports_schedule_id_idx on problem_reports (schedule_id);
create index problem_reports_revision_id_idx on problem_reports (revision_id);
create index problem_reports_driver_id_idx on problem_reports (driver_id);
create index problem_reports_handled_by_idx on problem_reports (handled_by_account_id);

-- A DONE completion is locked for everyone, service role included.
create function prevent_done_completion_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'DONE' then
    raise exception 'This trip is marked as done and is locked' using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trip_completions_done_lock
  before update or delete on trip_completions
  for each row execute function prevent_done_completion_changes();

alter table trip_completions enable row level security;
alter table problem_reports enable row level security;

grant select on trip_completions, problem_reports to authenticated;

-- Admin sees all; a Driver sees their own. Scheduler and Requester don't
-- see completion details (odometers) -- their view is the schedule.
create policy trip_completions_select on trip_completions for select
  using (
    driver_id = (select auth.uid())
    or (select current_account_role()) = 'Admin'
  );

-- Scheduler also sees problem reports: they build the follow-up schedule.
create policy problem_reports_select on problem_reports for select
  using (
    driver_id = (select auth.uid())
    or (select current_account_role()) in ('Admin', 'Scheduler')
  );

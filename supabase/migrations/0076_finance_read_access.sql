-- Finance reads what the Admin reads about trips (owner's request,
-- 2026-10-20): every schedule and its versions, the requests on them,
-- finished-trip details (odometer, fuel checks, corrected times, problem
-- reports, stop taps) and attendance. Read only: every write RPC checks
-- the role itself (Admin, Scheduler, the Driver or the requester), and
-- none of them lets Finance in. Cancellation asks and audit events stay
-- Admin-only. Each function body is otherwise as before.

create or replace function can_view_request_details(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.current_account_role()) in ('Admin', 'Scheduler', 'Finance')
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

create or replace function can_view_revision(p_revision_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.current_account_role()) in ('Admin', 'Scheduler', 'Finance')
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

create or replace function can_view_schedule(p_schedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.current_account_role()) in ('Admin', 'Scheduler', 'Finance')
    or exists (
      select 1 from public.schedules s
      where s.id = p_schedule_id and public.can_view_revision(s.published_revision_id)
    );
$$;

create or replace function can_view_request_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select public.current_account_role()) in ('Admin', 'Scheduler', 'Finance')
    or exists (
      select 1 from public.request_groups g
      where g.id = p_group_id
        and (g.owner_account_id = (select auth.uid()) or g.driver_id = (select auth.uid()))
    )
    or exists (
      select 1 from public.requests r
      where r.group_id = p_group_id and public.can_view_request_details(r.id)
    );
$$;

drop policy trip_completions_select on trip_completions;
create policy trip_completions_select on trip_completions for select
  using (
    driver_id = (select auth.uid())
    or (select public.current_account_role()) in ('Admin', 'Finance')
  );

drop policy trip_time_corrections_select on trip_time_corrections;
create policy trip_time_corrections_select on trip_time_corrections for select
  using (
    (select public.current_account_role()) in ('Admin', 'Finance')
    or exists (
      select 1 from public.schedule_revisions r
      where r.id = trip_time_corrections.revision_id and r.driver_id = (select auth.uid())
    )
  );

drop policy problem_reports_select on problem_reports;
create policy problem_reports_select on problem_reports for select
  using (
    driver_id = (select auth.uid())
    or reported_by_account_id = (select auth.uid())
    or (select public.current_account_role()) in ('Admin', 'Scheduler', 'Finance')
  );

drop policy trip_attendance_select on trip_attendance;
create policy trip_attendance_select on trip_attendance for select
  using (
    driver_id = (select auth.uid())
    or (select public.current_account_role()) in ('Admin', 'Scheduler', 'Finance')
  );

drop policy stop_taps_select on stop_taps;
create policy stop_taps_select on stop_taps for select
  using (
    driver_id = (select auth.uid())
    or recorded_by_account_id = (select auth.uid())
    or (select public.current_account_role()) in ('Admin', 'Scheduler', 'Finance')
    or exists (
      select 1 from public.schedules s
      where s.id = stop_taps.schedule_id and s.kind = 'COMPANY' and public.can_view_schedule(s.id)
    )
  );

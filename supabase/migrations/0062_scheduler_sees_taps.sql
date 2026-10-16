-- Schedulers see Start / End trip (0042) and Arrived / Leaving (0045) taps.
-- Until now only the Driver and Admins could, so on Scheduling a Scheduler
-- never saw a trip as on the road or a stop as reached: the legs the Driver
-- had already been to looked editable, and Fit it in could put a stop
-- before them (approval then refused it, 0060). Same rows an Admin sees.

drop policy trip_attendance_select on trip_attendance;
create policy trip_attendance_select on trip_attendance for select
  using (
    driver_id = (select auth.uid())
    or (select current_account_role()) in ('Admin', 'Scheduler')
  );

-- Same as 0055, plus Schedulers.
drop policy stop_taps_select on stop_taps;
create policy stop_taps_select on stop_taps for select
  using (
    driver_id = (select auth.uid())
    or recorded_by_account_id = (select auth.uid())
    or (select current_account_role()) in ('Admin', 'Scheduler')
    or exists (select 1 from public.schedules s where s.id = schedule_id and s.kind = 'COMPANY' and public.can_view_schedule(s.id))
  );

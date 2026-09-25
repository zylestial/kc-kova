-- v2.0 problem reports: optional link to a follow-up schedule.
--
-- An Admin handling a problem report can point at the schedule that fixes it
-- (for example a replacement trip). Only a HANDLED report can carry the link,
-- and it can't point back at the schedule the problem was reported on.

alter table problem_reports
  add column follow_up_schedule_id uuid references schedules (id),
  add constraint problem_reports_follow_up_check
    check (
      follow_up_schedule_id is null
      or (status = 'HANDLED' and follow_up_schedule_id <> schedule_id)
    );

create index problem_reports_follow_up_idx on problem_reports (follow_up_schedule_id);

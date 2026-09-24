-- v2.0 request progress, derived rather than stored.
--
-- A request's progress is computed from its inclusion, the schedule's
-- revisions and the completion record, so there is no second copy that
-- can drift out of step with them:
--   CANCELLED          request cancelled
--   NOT_YET_SCHEDULED  no active inclusion (never scheduled, or released
--                      by a draft discard / removal)
--   SCHEDULING         in a draft or returned revision, not yet published
--   PENDING_APPROVAL   in a revision submitted to Admin, not yet published
--   APPROVED           in the published revision
--   COMPLETED          Driver submitted completion for the schedule
--   DONE               Admin marked the completed trip done
-- A pending cancellation is reported separately (cancellation_pending):
-- the request keeps its real progress until an Admin confirms it.
--
-- The label is computed by a security definer function so a Requester sees
-- their request's progress without gaining read access to draft schedules.
-- The view itself is security_invoker, so it only lists requests the
-- caller could already read.

create function request_progress_of(p_request_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select case
    when not public.can_view_request_details(r.id) then null
    when r.status = 'CANCELLED' then 'CANCELLED'
    when inc.id is null then 'NOT_YET_SCHEDULED'
    when tc.status = 'DONE' then 'DONE'
    when tc.id is not null then 'COMPLETED'
    when exists (
      select 1 from public.revision_requests rr
      where rr.revision_id = s.published_revision_id and rr.request_id = r.id
    ) then 'APPROVED'
    when exists (
      select 1 from public.schedule_revisions sr
      join public.revision_requests rr on rr.revision_id = sr.id
      where sr.schedule_id = s.id and sr.status = 'SUBMITTED' and rr.request_id = r.id
    ) then 'PENDING_APPROVAL'
    else 'SCHEDULING'
  end
  from public.requests r
  left join public.schedule_requests inc on inc.request_id = r.id and inc.active
  left join public.schedules s on s.id = inc.schedule_id
  left join public.trip_completions tc on tc.schedule_id = s.id
  where r.id = p_request_id;
$$;

-- Same visibility rule as the label; request_cancellations' own RLS would
-- otherwise hide a pending cancellation from the Scheduler and Driver.
create function request_cancellation_pending(p_request_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select public.can_view_request_details(p_request_id) and exists (
    select 1 from public.request_cancellations
    where request_id = p_request_id and status = 'PENDING'
  );
$$;

revoke execute on function request_progress_of(uuid) from public, anon;
grant execute on function request_progress_of(uuid) to authenticated;
revoke execute on function request_cancellation_pending(uuid) from public, anon;
grant execute on function request_cancellation_pending(uuid) to authenticated;

create view request_progress with (security_invoker = true) as
select
  r.id as request_id,
  request_progress_of(r.id) as progress,
  request_cancellation_pending(r.id) as cancellation_pending
from requests r;

revoke all on request_progress from anon;
grant select on request_progress to authenticated;

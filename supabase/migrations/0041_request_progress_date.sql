-- v2.5: let the app load only recent requests' progress.
--
-- request_progress computes request_progress_of() for every request, so
-- GET /api/bootstrap paid for every request ever made. Exposing
-- requested_date lets the route filter (`requested_date >= since`) and
-- Postgres then only evaluates the function for that window.
--
-- Same view otherwise; a new column goes last, so create or replace is
-- allowed and the existing grants stay.
create or replace view request_progress with (security_invoker = true) as
select
  r.id as request_id,
  request_progress_of(r.id) as progress,
  request_cancellation_pending(r.id) as cancellation_pending,
  r.requested_date
from requests r;

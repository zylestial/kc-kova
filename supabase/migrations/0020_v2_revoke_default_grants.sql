-- Make the v2 tables' access explicit instead of inherited.
--
-- Supabase's project template sets default privileges that grant ALL
-- (including TRUNCATE, which ignores RLS) on every new public table to anon
-- and authenticated. RLS already denies row writes on these tables, since
-- none has a write policy, but that leaves the guarantee resting on a
-- template default that differs between projects (see 0005's comment).
-- Here: anon gets nothing; authenticated keeps only SELECT (still filtered
-- by RLS). All v2 writes go through security definer RPCs.

revoke all on
  requests, request_destinations, request_cancellations,
  schedules, schedule_revisions, revision_requests, schedule_requests,
  schedule_legs, leg_stops, schedule_reservations,
  trip_completions, problem_reports, audit_events
from anon;

revoke insert, update, delete, truncate, references, trigger on
  requests, request_destinations, request_cancellations,
  schedules, schedule_revisions, revision_requests, schedule_requests,
  schedule_legs, leg_stops, schedule_reservations,
  trip_completions, problem_reports, audit_events
from authenticated;

revoke usage on sequence audit_events_id_seq from anon, authenticated;

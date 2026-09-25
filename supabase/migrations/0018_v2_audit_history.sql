-- v2.0 append-only audit history.
--
-- Every insert/update/delete on the v2 request, schedule and completion
-- tables writes one audit_events row with the acting account, its role at
-- that moment, and the full before/after row. RPCs can label an event and
-- give a reason via transaction-local settings:
--   perform set_config('kova.audit_action', 'schedule.approve', true);
--   perform set_config('kova.audit_reason', p_comment, true);
-- otherwise the action is the plain operation (insert/update/delete).
--
-- audit_events can't be updated, deleted or truncated by anyone, service
-- role included. Events are never rewritten later (e.g. when Booker became
-- Requester): actor_role records the role as it was.
--
-- schedule_reservations is deliberately not audited: its rows are derived
-- from the revision's legs, which are.

create table audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  -- No foreign key: evidence must outlive the account it names.
  actor_account_id uuid,
  actor_role text,
  action text not null,
  table_name text not null,
  record_id uuid,
  reason text,
  before jsonb,
  after jsonb
);

create index audit_events_record_id_idx on audit_events (record_id);
create index audit_events_actor_account_id_idx on audit_events (actor_account_id);
create index audit_events_occurred_at_idx on audit_events (occurred_at);

create function write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and v_before = v_after then
    return new;
  end if;

  insert into public.audit_events (
    actor_account_id, actor_role, action, table_name, record_id, reason, before, after
  ) values (
    auth.uid(),
    (select role from public.accounts where id = auth.uid()),
    coalesce(nullif(current_setting('kova.audit_action', true), ''), lower(tg_op)),
    tg_table_name,
    (coalesce(v_after, v_before) ->> 'id')::uuid,
    nullif(current_setting('kova.audit_reason', true), ''),
    v_before,
    v_after
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function write_audit_event() from public;
revoke execute on function write_audit_event() from anon;

create function prevent_audit_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit history is append-only' using errcode = '42501';
end;
$$;

create trigger audit_events_append_only
  before update or delete on audit_events
  for each row execute function prevent_audit_changes();
create trigger audit_events_no_truncate
  before truncate on audit_events
  for each statement execute function prevent_audit_changes();

create trigger requests_audit
  after insert or update or delete on requests
  for each row execute function write_audit_event();
create trigger request_destinations_audit
  after insert or update or delete on request_destinations
  for each row execute function write_audit_event();
create trigger request_cancellations_audit
  after insert or update or delete on request_cancellations
  for each row execute function write_audit_event();
create trigger schedules_audit
  after insert or update or delete on schedules
  for each row execute function write_audit_event();
create trigger schedule_revisions_audit
  after insert or update or delete on schedule_revisions
  for each row execute function write_audit_event();
create trigger revision_requests_audit
  after insert or update or delete on revision_requests
  for each row execute function write_audit_event();
create trigger schedule_requests_audit
  after insert or update or delete on schedule_requests
  for each row execute function write_audit_event();
create trigger schedule_legs_audit
  after insert or update or delete on schedule_legs
  for each row execute function write_audit_event();
create trigger leg_stops_audit
  after insert or update or delete on leg_stops
  for each row execute function write_audit_event();
create trigger trip_completions_audit
  after insert or update or delete on trip_completions
  for each row execute function write_audit_event();
create trigger problem_reports_audit
  after insert or update or delete on problem_reports
  for each row execute function write_audit_event();

alter table audit_events enable row level security;

grant select on audit_events to authenticated;

create policy audit_events_select on audit_events for select
  using ((select current_account_role()) = 'Admin');

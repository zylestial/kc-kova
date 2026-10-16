-- Missed stops can go on another day (owner's request, 2026-10-16). Until
-- now a missed stop planned again (0063) waited on the day it was asked
-- for: only an "Any day that week" stop could be moved (0053), and once
-- that day passed the stop dropped off Scheduling, which shows today on.
--
-- requests.missed_at: set by release_missed_stop when a missed stop's
-- requests come off the trip.
--
-- release_missed_stop: same as 0063, except it sets missed_at.
-- move_request_day: same as 0053, except a missed stop, or a waiting stop
-- whose day has passed, may move to any day from today (Sundays too), and
-- the requester is told why.

alter table requests add column missed_at timestamptz;

create or replace function release_missed_stop(p_problem_id uuid, p_send_back boolean default false, p_reason text default '')
returns setof public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_report public.problem_reports;
  v_schedule public.schedules;
  v_destinations uuid[];
  v_request_ids uuid[];
  v_revision_id uuid;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Only a Scheduler can plan a missed stop again' using errcode = '42501';
  end if;

  select * into v_schedule from public.schedules
  where id = (select schedule_id from public.problem_reports where id = p_problem_id)
  for update;
  select * into v_report from public.problem_reports where id = p_problem_id for update;
  if v_report.id is null then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  if not v_report.missed then
    raise exception 'Only a missed stop can be planned again' using errcode = '22023';
  end if;
  if v_report.status = 'HANDLED' then
    raise exception 'This missed stop was already handled. Reload and try again' using errcode = '22023';
  end if;
  if v_schedule.status <> 'ACTIVE' then
    raise exception 'This trip is no longer active' using errcode = '22023';
  end if;

  select array_agg(ls.request_destination_id), array_agg(distinct rd.request_id)
  into v_destinations, v_request_ids
  from public.leg_stops ls
  join public.request_destinations rd on rd.id = ls.request_destination_id
  where ls.leg_id = v_report.leg_id and ls.revision_id = v_schedule.published_revision_id;
  if v_request_ids is null then
    raise exception 'This stop has no requests left on the trip. Reload and try again' using errcode = '22023';
  end if;
  -- A request from before 0052 can have stops on other legs too.
  if exists (
    select 1 from public.request_destinations
    where request_id = any(v_request_ids) and active and not (id = any(v_destinations))
  ) then
    raise exception 'A request at this stop has other stops on the trip; change the trip instead' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'problem.release_missed', true);
  perform set_config('kova.audit_is_override', (v_actor.role = 'Admin')::text, true);

  -- Off the version the Driver follows, and off draft changes to it.
  for v_revision_id in
    select id from public.schedule_revisions
    where schedule_id = v_schedule.id
      and (id = v_schedule.published_revision_id or status in ('DRAFT', 'SUBMITTED', 'RETURNED'))
  loop
    perform set_config('kova.live_edit_revision', v_revision_id::text, true);
    delete from public.leg_stops where revision_id = v_revision_id and request_destination_id = any(v_destinations);
    delete from public.revision_requests where revision_id = v_revision_id and request_id = any(v_request_ids);
    perform set_config('kova.live_edit_revision', '', true);
    update public.schedule_revisions set row_version = row_version + 1, updated_at = now() where id = v_revision_id;
  end loop;
  update public.schedules set updated_at = now() where id = v_schedule.id;
  perform public.sync_schedule_inclusions(v_schedule.id);

  -- Missed: the Scheduler may now move them to any day (move_request_day).
  update public.requests set missed_at = coalesce(missed_at, now()), row_version = row_version + 1, updated_at = now()
  where id = any(v_request_ids);

  update public.problem_reports set
    status = 'HANDLED',
    handled_at = now(),
    handled_by_account_id = v_actor.id,
    handling_note = case when p_send_back then 'Sent back to the requester' else 'Planned again' end
  where id = p_problem_id;

  if p_send_back then
    perform public.send_back_requests(v_request_ids, p_reason);
  end if;

  return query select * from public.requests where id = any(v_request_ids) order by id;
end;
$$;

create or replace function move_request_day(p_request_id uuid, p_date date)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_request public.requests;
  v_group public.request_groups;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_from date;
  v_anyday boolean;
  v_label text;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Only a Scheduler can move a stop to another day' using errcode = '42501';
  end if;

  select * into v_request from public.requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  select * into v_group from public.request_groups where id = v_request.group_id;
  if v_request.status <> 'ACTIVE' then
    raise exception 'This stop was cancelled. Reload and try again' using errcode = '22023';
  end if;
  -- A missed stop, or one whose day has passed, may go on any day from today.
  v_anyday := v_request.missed_at is not null or v_request.requested_date < v_today;
  if not v_anyday and (v_request.flexibility <> 'WEEK' or v_group.id is null) then
    raise exception 'Only a stop the requester marked "Any day that week", a missed stop, or one whose day has passed can be moved' using errcode = '22023';
  end if;
  if exists (select 1 from public.schedule_requests where request_id = p_request_id and active) then
    raise exception 'This stop is already in a schedule; remove it from that schedule first' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'Pick a day' using errcode = '22023';
  end if;
  if not v_anyday and (
    public.week_monday(p_date) <> public.week_monday(v_group.requested_date)
    or extract(isodow from p_date) = 7
  ) then
    raise exception 'Pick a day from Monday to Saturday of the week the requester asked for' using errcode = '22023';
  end if;
  if p_date < v_today then
    raise exception 'That day has passed' using errcode = '22023';
  end if;
  if p_date = v_request.requested_date then
    return v_request;
  end if;

  v_from := v_request.requested_date;
  -- Requests from before request groups (0052) have no stop number.
  v_label := case when v_group.id is null then 'Your stop' else format('Stop %s-%s', v_group.number, v_request.stop_letter) end;
  perform set_config('kova.audit_action', 'request.move_day', true);
  perform set_config('kova.audit_is_override', (v_actor.role = 'Admin')::text, true);

  -- A new day also clears a send-back (0038's trigger).
  update public.requests set
    requested_date = p_date,
    moved_at = case when p_date = v_group.requested_date then null else now() end,
    moved_by_account_id = case when p_date = v_group.requested_date then null else v_actor.id end,
    row_version = row_version + 1,
    updated_at = now()
  where id = p_request_id
  returning * into v_request;

  if v_request.owner_account_id <> v_actor.id then
    perform public.notify(
      v_request.owner_account_id,
      'REQUEST_MOVED',
      case
        when v_request.missed_at is not null then
          format('%s was missed on %s. It is now on %s',
            v_label, to_char(v_from, 'FMMonth FMDD'), to_char(p_date, 'FMDay, FMMonth FMDD'))
        when v_anyday then
          format('%s wasn''t planned on %s. It is now on %s',
            v_label, to_char(v_from, 'FMMonth FMDD'), to_char(p_date, 'FMDay, FMMonth FMDD'))
        else
          format('Stop %s-%s is now on %s. You said any day that week would do',
            v_group.number, v_request.stop_letter, to_char(p_date, 'FMDay, FMMonth FMDD'))
      end,
      v_request.id
    );
  end if;
  return v_request;
end;
$$;

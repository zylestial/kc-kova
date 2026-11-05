-- Tasks at a stop (owner's request, 2026-11-05; prototype "KOVA Stop Tasks").
-- Between Arrived and Leaving, the Driver answers for each request at the stop:
-- Done, or Not yet done, which is the stop report already naming that request.
--
-- stop_tasks: one row per request marked Done at a leg, with its time. Undo
-- deletes it, until Leaving. Writes are RPC-only, like stop_taps.
--
-- Leaving is refused until every request at the stop is Done or skipped by the
-- Scheduler. On a Company trip the last stop has no Leaving, so End trip is
-- refused instead. A report waiting for an answer already holds the trip.
--
-- Trips on the road when this ships: a stop already Arrived at keeps working
-- as before (before_tasks). The column default marks the rows already there
-- without firing their audit triggers; new rows get false.
--
-- report_stop: same as 0086, except a request marked Done can't be named, and a
-- report for the whole stop covers only the requests not Done, so a Skip never
-- plans a finished job again.
--
-- report_unreached_stops: same as 0087, except requests marked Done are never
-- planned again, and End trip now with requests not answered at the stop the
-- Driver is at counts them as Skip, with no decided_by_account_id, like a report
-- left open. Got it, it was done clears it if the job was done.

alter table stop_taps add column before_tasks boolean not null default true;
alter table stop_taps alter column before_tasks set default false;
alter table company_trip_runs add column before_tasks boolean not null default true;
alter table company_trip_runs alter column before_tasks set default false;

comment on column stop_taps.before_tasks is 'Tapped before tasks at a stop existed (0088): this stop''s Leaving needs no tasks marked.';
comment on column company_trip_runs.before_tasks is 'Started before tasks at a stop existed (0088): End trip needs no tasks marked at the last stop.';

create table stop_tasks (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references schedules (id),
  revision_id uuid not null,
  leg_id uuid not null,
  request_id uuid not null references requests (id),
  at timestamptz not null default now(),
  -- When the server got one saved on the phone; null when it arrived as tapped.
  sent_at timestamptz,
  recorded_by_account_id uuid not null references accounts (id),
  unique (leg_id, request_id),
  foreign key (leg_id, revision_id) references schedule_legs (id, revision_id)
);

create index stop_tasks_schedule_id_idx on stop_tasks (schedule_id);
create index stop_tasks_revision_id_idx on stop_tasks (revision_id);
create index stop_tasks_leg_id_revision_id_idx on stop_tasks (leg_id, revision_id);
create index stop_tasks_request_id_idx on stop_tasks (request_id);
create index stop_tasks_recorded_by_idx on stop_tasks (recorded_by_account_id);

create trigger stop_tasks_audit
  after insert or update or delete on stop_tasks
  for each row execute function write_audit_event();

alter table stop_tasks enable row level security;

grant select on stop_tasks to authenticated;

-- Same as stop_taps, plus the requester of that request.
create policy stop_tasks_select on stop_tasks for select
  using (
    recorded_by_account_id = (select auth.uid())
    or (select current_account_role()) = any (array['Admin', 'Scheduler', 'Finance'])
    or exists (select 1 from requests r where r.id = stop_tasks.request_id and r.owner_account_id = (select auth.uid()))
    or exists (
      select 1 from schedule_revisions v
      where v.id = stop_tasks.revision_id and v.driver_id = (select auth.uid())
    )
    or exists (
      select 1 from schedules s
      where s.id = stop_tasks.schedule_id and s.kind = 'COMPANY' and can_view_schedule(s.id)
    )
  );

-- The requests at a leg of the route the Driver follows.
create function leg_requests(p_leg_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct rd.request_id), '{}')
  from public.leg_stops ls
  join public.request_destinations rd on rd.id = ls.request_destination_id
  where ls.leg_id = p_leg_id;
$$;

-- The requests at a leg still to answer for: not Done, and not skipped by the Scheduler.
create function leg_tasks_open(p_leg_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(id), '{}')
  from unnest(public.leg_requests(p_leg_id)) as ids (id)
  where not exists (select 1 from public.stop_tasks d where d.leg_id = p_leg_id and d.request_id = ids.id)
    and not exists (
      select 1 from public.problem_reports p
      where p.leg_id = p_leg_id and p.decision = 'SKIP' and (p.request_ids is null or ids.id = any(p.request_ids))
    );
$$;

revoke execute on function leg_requests(uuid) from public, anon, authenticated;
revoke execute on function leg_tasks_open(uuid) from public, anon, authenticated;

create function refuse_leaving_with_tasks_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'LEAVE' or public.leg_missed(new.leg_id) then
    return new;
  end if;
  if exists (select 1 from public.stop_taps where leg_id = new.leg_id and kind = 'ARRIVE' and before_tasks) then
    return new;
  end if;
  if cardinality(public.leg_tasks_open(new.leg_id)) > 0 then
    raise exception 'Mark each task here as Done or Not yet done first' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function refuse_leaving_with_tasks_open() from public, anon, authenticated;

create trigger stop_taps_tasks_marked
  before insert on stop_taps
  for each row execute function refuse_leaving_with_tasks_open();

create function refuse_company_end_with_tasks_open()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leg uuid;
begin
  if old.end_at is not null or new.end_at is null or old.before_tasks then
    return new;
  end if;
  select l.id into v_leg
  from public.schedule_legs l
  where l.revision_id = (select published_revision_id from public.schedules where id = new.schedule_id)
  order by l.leg_no desc limit 1;
  if v_leg is not null and not public.leg_missed(v_leg) and cardinality(public.leg_tasks_open(v_leg)) > 0 then
    raise exception 'Mark each task here as Done or Not yet done first' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function refuse_company_end_with_tasks_open() from public, anon, authenticated;

create trigger company_trip_runs_tasks_marked
  before update on company_trip_runs
  for each row execute function refuse_company_end_with_tasks_open();

-- Checks shared by Done and Undo; returns the leg. Company trips' last stop is
-- reached by End trip, so it has no Arrived: the stop before it must be left.
create function stop_task_leg(p_schedule_id uuid, p_leg_id uuid, p_revision public.schedule_revisions)
returns public.schedule_legs
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_leg public.schedule_legs;
  v_company boolean;
begin
  select * into v_leg from public.schedule_legs where id = p_leg_id and revision_id = p_revision.id;
  if v_leg.id is null or v_leg.is_final then
    raise exception 'That stop isn''t on this trip any more' using errcode = 'P0002';
  end if;
  v_company := (select kind = 'COMPANY' from public.schedules where id = p_schedule_id);
  if exists (select 1 from public.stop_taps where leg_id = p_leg_id and kind = 'LEAVE') then
    raise exception 'You already left this stop' using errcode = '22023';
  end if;
  if v_company and v_leg.leg_no = (select max(leg_no) from public.schedule_legs where revision_id = p_revision.id) then
    if v_leg.leg_no > 1 and not exists (
      select 1 from public.schedule_legs l
      where l.revision_id = p_revision.id and l.leg_no = v_leg.leg_no - 1
        and (public.leg_missed(l.id) or exists (select 1 from public.stop_taps t where t.leg_id = l.id and t.kind = 'LEAVE'))
    ) then
      raise exception 'Tap Leaving the stop before this one first' using errcode = '22023';
    end if;
  elsif not exists (select 1 from public.stop_taps where leg_id = p_leg_id and kind = 'ARRIVE') then
    raise exception 'Tap Arrived at this stop first' using errcode = '22023';
  end if;
  return v_leg;
end;
$$;

revoke execute on function stop_task_leg(uuid, uuid, public.schedule_revisions) from public, anon, authenticated;

-- Marks one request at a stop Done. A repeat returns the first. Works while the
-- trip is held, so the other tasks at the stop can still be finished.
create function record_stop_task(p_schedule_id uuid, p_leg_id uuid, p_request_id uuid)
returns public.stop_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_revision public.schedule_revisions;
  v_leg public.schedule_legs;
  v_row public.stop_tasks;
  v_tapped timestamptz := nullif(current_setting('kova.tapped_at', true), '')::timestamptz;
  v_floor timestamptz;
  v_at timestamptz := now();
begin
  select * into v_actor from public.accounts where id = auth.uid();
  v_revision := public.trip_for_reporting(p_schedule_id, v_actor);

  select * into v_row from public.stop_tasks where leg_id = p_leg_id and request_id = p_request_id;
  if found then
    return v_row;
  end if;

  v_leg := public.stop_task_leg(p_schedule_id, p_leg_id, v_revision);
  if not (p_request_id = any(public.leg_requests(p_leg_id))) then
    raise exception 'That task isn''t at this stop any more' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.problem_reports p
    where p.leg_id = p_leg_id and p.decision = 'SKIP' and (p.request_ids is null or p_request_id = any(p.request_ids))
  ) then
    raise exception 'The Scheduler skipped this one' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.problem_reports p
    where p.leg_id = p_leg_id and p.status = 'OPEN' and p.kind <> 'NOT_REACHED'
      and (p.decision is null or p.decision = 'CHANGE')
      and (p.request_ids is null or p_request_id = any(p.request_ids))
  ) then
    raise exception 'Wait for the Scheduler''s answer on this one' using errcode = '22023';
  end if;

  if v_tapped is not null then
    select greatest(
      (select start_at from public.trip_attendance where schedule_id = p_schedule_id),
      (select start_at from public.company_trip_runs where schedule_id = p_schedule_id),
      (select at from public.stop_taps where leg_id = p_leg_id and kind = 'ARRIVE')
    ) into v_floor;
    v_at := public.bounded_tap_time(v_tapped, v_floor);
  end if;

  perform set_config('kova.audit_action', 'stop.task_done', true);
  insert into public.stop_tasks (schedule_id, revision_id, leg_id, request_id, at, sent_at, recorded_by_account_id)
  values (p_schedule_id, v_revision.id, p_leg_id, p_request_id, v_at, case when v_tapped is not null then now() end, v_actor.id)
  returning * into v_row;
  return v_row;
end;
$$;

-- The phone's time, for a tap saved with no signal (0077).
create function record_stop_task_at(p_tapped_at timestamptz, p_schedule_id uuid, p_leg_id uuid, p_request_id uuid)
returns public.stop_tasks
language plpgsql
set search_path = ''
as $$
declare
  v_row public.stop_tasks;
begin
  if p_tapped_at is null then
    raise exception 'The tap has no time' using errcode = '22023';
  end if;
  perform set_config('kova.tapped_at', p_tapped_at::text, true);
  v_row := public.record_stop_task(p_schedule_id, p_leg_id, p_request_id);
  perform set_config('kova.tapped_at', '', true);
  return v_row;
end;
$$;

-- Takes back a Done tapped by mistake, until Leaving. A repeat does nothing.
create function undo_stop_task(p_schedule_id uuid, p_leg_id uuid, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_revision public.schedule_revisions;
  v_leg public.schedule_legs;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  v_revision := public.trip_for_reporting(p_schedule_id, v_actor);
  v_leg := public.stop_task_leg(p_schedule_id, p_leg_id, v_revision);
  perform set_config('kova.audit_action', 'stop.task_undone', true);
  delete from public.stop_tasks where leg_id = v_leg.id and request_id = p_request_id;
end;
$$;

revoke execute on function record_stop_task(uuid, uuid, uuid) from public, anon;
revoke execute on function record_stop_task_at(timestamptz, uuid, uuid, uuid) from public, anon;
revoke execute on function undo_stop_task(uuid, uuid, uuid) from public, anon;
grant execute on function record_stop_task(uuid, uuid, uuid) to authenticated;
grant execute on function record_stop_task_at(timestamptz, uuid, uuid, uuid) to authenticated;
grant execute on function undo_stop_task(uuid, uuid, uuid) to authenticated;

create or replace function report_stop(p_schedule_id uuid, p_leg_id uuid, p_kind text, p_note text DEFAULT ''::text, p_skip boolean DEFAULT false, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_accuracy_m double precision DEFAULT NULL::double precision, p_request_ids uuid[] DEFAULT NULL::uuid[])

returns public.problem_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_revision public.schedule_revisions;
  v_schedule public.schedules;
  v_leg public.schedule_legs;
  v_missed boolean;
  v_note text := coalesce(trim(p_note), '');
  v_report public.problem_reports;
  v_label text;
  v_at_stop uuid[];
  v_partial boolean := false;
  v_which text;
  v_named uuid[] := p_request_ids;
  v_done uuid[];
begin
  select * into v_actor from public.accounts where id = auth.uid();
  v_revision := public.trip_for_reporting(p_schedule_id, v_actor);
  select * into v_schedule from public.schedules where id = p_schedule_id;
  if p_kind is null or p_kind not in ('NOT_AVAILABLE', 'NOT_READY', 'WRONG_ADDRESS', 'ROAD_BLOCKED', 'VEHICLE_PROBLEM', 'OTHER') then
    raise exception 'Choose what happened' using errcode = '22023';
  end if;
  perform public.check_tap_location(p_lat, p_lng, p_accuracy_m);

  select * into v_leg from public.schedule_legs where id = p_leg_id and revision_id = v_revision.id;
  if v_leg.id is null then
    raise exception 'That stop isn''t on this trip any more' using errcode = 'P0002';
  end if;
  if v_leg.is_final then
    raise exception 'Report the way back to ANONANG as a problem with the trip' using errcode = '22023';
  end if;

  -- Some of the requests at this stop, not all: the stop is still reached.
  select coalesce(array_agg(distinct rd.request_id), '{}') into v_at_stop
  from public.leg_stops ls
  join public.request_destinations rd on rd.id = ls.request_destination_id
  where ls.leg_id = v_leg.id and ls.revision_id = v_revision.id;
  if p_request_ids is not null and cardinality(p_request_ids) > 0 then
    if not (p_request_ids <@ v_at_stop) then
      raise exception 'Choose stops at this place' using errcode = '22023';
    end if;
    v_partial := not (v_at_stop <@ p_request_ids);
    if v_partial and p_kind not in ('NOT_AVAILABLE', 'NOT_READY', 'WRONG_ADDRESS', 'OTHER') then
      raise exception 'Only Not available, Not ready, Wrong address or Something else can be for some of the stops here' using errcode = '22023';
    end if;
  end if;

  -- A job marked Done is finished: it can't be named, and a report for the whole
  -- stop covers only what's left, so a Skip never plans it again.
  select coalesce(array_agg(request_id), '{}') into v_done from public.stop_tasks where leg_id = v_leg.id;
  if p_request_ids is not null and cardinality(p_request_ids) > 0 then
    if p_request_ids && v_done then
      raise exception 'That task is marked Done. Tap Undo first' using errcode = '22023';
    end if;
  elsif cardinality(v_done) > 0 then
    select coalesce(array_agg(id), '{}') into v_named from unnest(v_at_stop) as ids (id) where not (id = any(v_done));
    if cardinality(v_named) = 0 then
      raise exception 'Every task here is done. Tap Leaving, then report it at the next stop' using errcode = '22023';
    end if;
    v_partial := true;
  end if;

  -- The Scheduler decides whether it's missed (answer_stop_report); p_skip is no longer used.
  v_missed := false;
  if public.leg_missed(v_leg.id) then
    raise exception 'This stop was already reported missed' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'problem.report_stop', true);
  insert into public.problem_reports (
    schedule_id, revision_id, driver_id, note, leg_id, kind, missed, reported_by_account_id, lat, lng, accuracy_m, request_ids
  ) values (
    p_schedule_id, v_revision.id, v_revision.driver_id, left(v_note, 500), v_leg.id, p_kind, v_missed, v_actor.id,
    p_lat, p_lng, p_accuracy_m, case when v_partial then v_named end
  ) returning * into v_report;

  -- Every report holds the trip until it's answered.
  perform public.refresh_trip_hold(p_schedule_id);

  v_label := public.stop_report_label(p_kind);
  if v_partial then
    select string_agg(coalesce(g.number || '-' || r.stop_letter, r.owner_name), ', ' order by g.number, r.stop_letter)
    into v_which
    from public.requests r
    left join public.request_groups g on g.id = r.group_id
    where r.id = any(v_named);
    v_label := format('%s for %s', v_label, v_which);
  end if;
  perform public.notify_schedulers(
    'STOP_REPORTED',
    format('%s at %s: %s''s trip on %s. Waiting for your answer', v_label, v_leg.destination_name, v_revision.plate, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null, p_schedule_id
  );
  perform public.notify_admins(
    'STOP_REPORTED',
    format('%s at %s: %s''s trip on %s. Waiting for your answer', v_label, v_leg.destination_name, v_revision.plate, to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
    null, p_schedule_id
  );

  return v_report;
end;
$$;

create or replace function report_unreached_stops()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule public.schedules;
  v_revision public.schedule_revisions;
  v_last int;
  v_leg public.schedule_legs;
  v_report public.problem_reports;
  v_covered uuid[];
  v_left uuid[];
  v_whole boolean;
  v_has_stops boolean;
  v_any_done boolean;
  v_places text[] := '{}';
  v_to_plan text[] := '{}';
  v_action text := current_setting('kova.audit_action', true);
begin
  if old.end_at is not null or new.end_at is null then
    return new;
  end if;
  select * into v_schedule from public.schedules where id = new.schedule_id;
  update public.schedules set paused_at = null where id = new.schedule_id;
  select * into v_revision from public.schedule_revisions where id = v_schedule.published_revision_id;
  if v_revision.id is not null then
    -- The last leg reached: tapped, or reported missed.
    select coalesce(max(l.leg_no), 0) into v_last
    from public.schedule_legs l
    where l.revision_id = v_revision.id
      and (exists (select 1 from public.stop_taps t where t.leg_id = l.id) or public.leg_missed(l.id));

    perform set_config('kova.audit_action', 'problem.not_reached', true);

    -- A report on a stop reached, not answered or answered End the trip, or
    -- answered Wait there on the last stop reached and never left: as if answered
    -- Skip. Nobody chose it, so it has no decided_by_account_id.
    for v_report in
      select p.* from public.problem_reports p
      join public.schedule_legs l on l.id = p.leg_id and l.revision_id = v_revision.id
      where p.schedule_id = new.schedule_id and l.leg_no <= v_last and p.kind <> 'NOT_REACHED'
        and (p.decision = 'END' or (p.status = 'OPEN' and (p.decision is null or p.decision = 'CHANGE'))
          or (p.decision = 'WAIT' and l.leg_no = v_last
            and not exists (select 1 from public.stop_taps t where t.leg_id = l.id and t.kind = 'LEAVE')))
      order by p.created_at
    loop
      select * into v_leg from public.schedule_legs where id = v_report.leg_id;
      -- Requests another report here already covers aren't planned twice.
      select coalesce(array_agg(distinct ids.id), '{}') into v_covered
      from public.problem_reports p, unnest(p.request_ids) as ids (id)
      where p.leg_id = v_leg.id and p.status = 'OPEN' and p.decision = 'SKIP';
      select coalesce(array_agg(distinct rd.request_id), '{}') into v_left
      from public.leg_stops ls
      join public.request_destinations rd on rd.id = ls.request_destination_id
      where ls.leg_id = v_leg.id and ls.revision_id = v_revision.id
        and (v_report.request_ids is null or rd.request_id = any(v_report.request_ids))
        and not (rd.request_id = any(v_covered))
        and not exists (select 1 from public.stop_tasks d where d.leg_id = v_leg.id and d.request_id = rd.request_id);
      v_any_done := exists (select 1 from public.stop_tasks d where d.leg_id = v_leg.id);

      if cardinality(v_left) = 0 or public.leg_missed(v_leg.id) then
        -- Answered End the trip or Wait there keeps its own closing note.
        if v_report.status = 'OPEN' then
          update public.problem_reports set status = 'HANDLED', handled_at = now(), handling_note = 'The trip ended'
          where id = v_report.id;
        end if;
        continue;
      end if;

      v_whole := v_report.request_ids is null and cardinality(v_covered) = 0 and not v_any_done;
      update public.problem_reports set
        decision = 'SKIP',
        decided_at = now(),
        decided_by_account_id = null,
        missed = v_whole,
        request_ids = case when v_whole then null else v_left end,
        status = 'OPEN',
        handled_at = null,
        handled_by_account_id = null,
        handling_note = ''
      where id = v_report.id;
      v_to_plan := v_to_plan || v_leg.destination_name;
      perform public.notify_stop_missed(v_leg, public.stop_report_label(v_report.kind), new.end_recorded_by_account_id, v_left);
    end loop;
  end if;

  -- Requests not answered at the stop the Driver was at, with no report about
  -- them: not known to be done, so they count as Skip too. Not for a stop
  -- Arrived at before tasks existed (before_tasks).
  if v_revision.id is not null then
    select * into v_leg from public.schedule_legs l
    where l.revision_id = v_revision.id and l.leg_no = v_last and not l.is_final and not public.leg_missed(l.id)
      and exists (select 1 from public.stop_taps t where t.leg_id = l.id and t.kind = 'ARRIVE' and not t.before_tasks)
      and not exists (select 1 from public.stop_taps t where t.leg_id = l.id and t.kind = 'LEAVE');
    if found then
      select coalesce(array_agg(ids.id), '{}') into v_left
      from unnest(public.leg_tasks_open(v_leg.id)) as ids (id)
      where not exists (
        select 1 from public.problem_reports p
        where p.leg_id = v_leg.id and p.kind <> 'NOT_REACHED' and (p.request_ids is null or ids.id = any(p.request_ids))
      );
      if cardinality(v_left) > 0 then
        v_whole := public.leg_requests(v_leg.id) <@ v_left;
        insert into public.problem_reports (
          schedule_id, revision_id, driver_id, note, leg_id, kind, missed, reported_by_account_id,
          decision, decided_at, request_ids
        ) values (
          v_schedule.id, v_revision.id, v_revision.driver_id, 'The trip ended before this was marked', v_leg.id, 'OTHER', v_whole,
          new.end_recorded_by_account_id, 'SKIP', now(), case when v_whole then null else v_left end
        );
        v_to_plan := v_to_plan || v_leg.destination_name;
        perform public.notify_stop_missed(v_leg, 'not marked done when the trip ended', new.end_recorded_by_account_id, v_left);
      end if;
    end if;
  end if;

  -- Any other report still waiting ends with the trip.
  update public.problem_reports set status = 'HANDLED', handled_at = now(), handling_note = 'The trip ended'
  where schedule_id = new.schedule_id and leg_id is not null and status = 'OPEN' and (decision is null or decision = 'CHANGE');
  if v_revision.id is null then
    return new;
  end if;

  for v_leg in
    select * from public.schedule_legs
    where revision_id = v_revision.id and not is_final and leg_no > v_last and not public.leg_missed(id)
    order by leg_no
  loop
    v_has_stops := exists (select 1 from public.leg_stops where leg_id = v_leg.id and revision_id = v_revision.id);
    insert into public.problem_reports (
      schedule_id, revision_id, driver_id, note, leg_id, kind, missed, reported_by_account_id,
      status, handled_at, handling_note
    ) values (
      v_schedule.id, v_revision.id, v_revision.driver_id, 'The trip ended before this stop', v_leg.id, 'NOT_REACHED', true,
      new.end_recorded_by_account_id,
      case when v_has_stops then 'OPEN' else 'HANDLED' end,
      case when v_has_stops then null else now() end,
      case when v_has_stops then '' else 'Nothing to plan again' end
    );
    v_places := v_places || v_leg.destination_name;
    if v_has_stops then
      perform public.notify_stop_missed(v_leg, 'not reached, the trip ended early', new.end_recorded_by_account_id);
    end if;
  end loop;
  perform set_config('kova.audit_action', coalesce(v_action, ''), true);

  if cardinality(v_places) > 0 then
    perform public.notify_schedulers(
      'STOP_REPORTED',
      format('Trip ended before %s: %s''s trip on %s', array_to_string(v_places, ', '), v_revision.plate,
        to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      null, v_schedule.id
    );
    perform public.notify_admins(
      'STOP_REPORTED',
      format('Trip ended before %s: %s''s trip on %s', array_to_string(v_places, ', '), v_revision.plate,
        to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      null, v_schedule.id
    );
  end if;
  if cardinality(v_to_plan) > 0 then
    perform public.notify_schedulers(
      'STOP_REPORTED',
      format('Trip ended with requests to plan again at %s: %s''s trip on %s', array_to_string(v_to_plan, ', '), v_revision.plate,
        to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      null, v_schedule.id
    );
    perform public.notify_admins(
      'STOP_REPORTED',
      format('Trip ended with requests to plan again at %s: %s''s trip on %s', array_to_string(v_to_plan, ', '), v_revision.plate,
        to_char(v_schedule.schedule_date, 'FMMonth FMDD, YYYY')),
      null, v_schedule.id
    );
  end if;
  return new;
end;
$$;

-- Stop times: an Admin fills in or corrects a leg's TIME OUT or TIME IN on a
-- submitted trip (a missed tap, a flat phone), and a trip can't be marked
-- Done until every leg has both. A correction never touches the tap it
-- replaces: the tap stays as evidence, the correction is what prints.
-- Writes are RPC-only; authenticated gets SELECT only.

create table trip_time_corrections (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references schedules (id),
  revision_id uuid not null,
  leg_id uuid not null,
  field text not null check (field in ('OUT', 'IN')),
  -- Manila wall-clock time, as written on the form.
  time time(0) not null,
  corrected_by_account_id uuid not null references accounts (id),
  corrected_at timestamptz not null default now(),
  unique (leg_id, field),
  foreign key (leg_id, revision_id) references schedule_legs (id, revision_id)
);

create index trip_time_corrections_schedule_id_idx on trip_time_corrections (schedule_id);
create index trip_time_corrections_leg_id_revision_id_idx on trip_time_corrections (leg_id, revision_id);
create index trip_time_corrections_corrected_by_idx on trip_time_corrections (corrected_by_account_id);

create trigger trip_time_corrections_audit
  after insert or update or delete on trip_time_corrections
  for each row execute function write_audit_event();

alter table trip_time_corrections enable row level security;

grant select on trip_time_corrections to authenticated;

-- Admin sees all; a Driver sees those on their own trips.
create policy trip_time_corrections_select on trip_time_corrections for select
  using (
    (select current_account_role()) = 'Admin'
    or exists (
      select 1 from schedule_revisions r
      where r.id = trip_time_corrections.revision_id and r.driver_id = (select auth.uid())
    )
  );

-- How many TIME OUT / TIME IN cells of a schedule's approved version have
-- neither a tap nor a correction. Leg 1 OUT is Start trip, leg N IN is
-- Arrived at it (End trip for the final leg), leg N+1 OUT is Leaving leg N.
create function trip_times_missing(p_schedule_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with legs as (
    select l.id, l.is_final,
      lag(l.id) over (order by l.leg_no) as previous_id,
      row_number() over (order by l.leg_no) as position
    from public.schedule_legs l
    join public.schedules s on s.published_revision_id = l.revision_id
    where s.id = p_schedule_id
  ),
  cells as (
    select legs.id, 'OUT' as field,
      case when legs.position = 1
        then (select a.start_at from public.trip_attendance a where a.schedule_id = p_schedule_id)
        else (select t.at from public.stop_taps t where t.leg_id = legs.previous_id and t.kind = 'LEAVE')
      end as tapped_at
    from legs
    union all
    select legs.id, 'IN',
      case when legs.is_final
        then (select a.end_at from public.trip_attendance a where a.schedule_id = p_schedule_id)
        else (select t.at from public.stop_taps t where t.leg_id = legs.id and t.kind = 'ARRIVE')
      end
    from legs
  )
  select count(*)::integer from cells
  where tapped_at is null
    and not exists (
      select 1 from public.trip_time_corrections c where c.leg_id = cells.id and c.field = cells.field
    );
$$;

revoke execute on function trip_times_missing(uuid) from public, anon;
grant execute on function trip_times_missing(uuid) to authenticated;

-- Sets (or, with a null time, clears) an Admin's TIME OUT / TIME IN for one
-- leg of a submitted trip that isn't Done yet. The leg must be in the
-- approved version.
create function set_trip_time(
  p_schedule_id uuid,
  p_leg_id uuid,
  p_field text,
  p_time time default null
)
returns setof public.trip_time_corrections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_schedule public.schedules;
  v_completion public.trip_completions;
  v_leg public.schedule_legs;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_field is null or p_field not in ('OUT', 'IN') then
    raise exception 'Choose Time Out or Time In' using errcode = '22023';
  end if;

  select * into v_schedule from public.schedules where id = p_schedule_id for update;
  if v_schedule is null then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_completion from public.trip_completions where schedule_id = p_schedule_id;
  if not found then
    raise exception 'Times can be filled in once the Driver submits the trip' using errcode = '22023';
  end if;
  if v_completion.status = 'DONE' then
    raise exception 'This trip is marked as done and is locked' using errcode = '22023';
  end if;

  select * into v_leg from public.schedule_legs
  where id = p_leg_id and revision_id = v_schedule.published_revision_id;
  if v_leg is null then
    raise exception 'That leg isn''t on this trip' using errcode = 'P0002';
  end if;

  if p_time is null then
    perform set_config('kova.audit_action', 'time.clear', true);
    delete from public.trip_time_corrections where leg_id = p_leg_id and field = p_field;
    return;
  end if;

  perform set_config('kova.audit_action', 'time.correct', true);
  return query
  insert into public.trip_time_corrections (schedule_id, revision_id, leg_id, field, time, corrected_by_account_id)
  values (p_schedule_id, v_leg.revision_id, p_leg_id, p_field, date_trunc('minute', p_time)::time(0), v_actor.id)
  on conflict (leg_id, field) do update
    set time = excluded.time, corrected_by_account_id = excluded.corrected_by_account_id, corrected_at = now()
  returning *;
end;
$$;

revoke execute on function set_trip_time(uuid, uuid, text, time) from public, anon;
grant execute on function set_trip_time(uuid, uuid, text, time) to authenticated;

-- mark_completion_done: same as 0031, plus every TIME OUT and TIME IN must
-- be there (tapped or filled in) so the printed form is complete. A repeat
-- still returns the existing done completion first.
create or replace function mark_completion_done(p_schedule_id uuid)
returns public.trip_completions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_completion public.trip_completions;
  v_missing integer;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role <> 'Admin' then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  perform 1 from public.schedules where id = p_schedule_id for update;
  if not found then
    raise exception 'Schedule not found' using errcode = 'P0002';
  end if;

  select * into v_completion from public.trip_completions where schedule_id = p_schedule_id;
  if not found then
    raise exception 'This trip has no completion to mark as done' using errcode = 'P0002';
  end if;
  if v_completion.status = 'DONE' then
    return v_completion;
  end if;

  v_missing := public.trip_times_missing(p_schedule_id);
  if v_missing > 0 then
    raise exception 'Fill in every Time Out and Time In before marking this trip done (% missing)', v_missing
      using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'completion.done', true);
  update public.trip_completions
  set status = 'DONE', done_at = now(), done_by_account_id = v_actor.id
  where id = v_completion.id
  returning * into v_completion;

  return v_completion;
end;
$$;

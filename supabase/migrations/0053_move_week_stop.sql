-- A Scheduler can move an "any day that week" stop to another day of its
-- week (Company Trip Flow / New Request prototypes). The requester said any
-- day that week would do, so no new date is asked of them; they are told.
--
-- The stop keeps the group's date as what was asked for, and records the
-- move. A later edit by the requester keeps the moved day while the stop is
-- still "any day that week" and the request stays in that week.

alter table requests
  add column moved_at timestamptz,
  add column moved_by_account_id uuid references accounts (id),
  add constraint requests_moved_consistent check ((moved_at is null) = (moved_by_account_id is null));

create index requests_moved_by_account_id_idx on requests (moved_by_account_id);

alter table notifications drop constraint notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'REQUEST_SCHEDULED',
  'REQUEST_RETURNED',
  'REQUEST_SENT_BACK',
  'REQUEST_SPLIT',
  'REQUEST_MOVED',
  'REQUEST_CANCELLED',
  'CANCELLATION_DECLINED',
  'CANCELLATION_REQUESTED',
  'PROBLEM_REPORTED',
  'SCHEDULE_SUBMITTED',
  'SCHEDULE_RETURNED',
  'TRIP_PUBLISHED'
));

-- Monday of a date's week.
create function week_monday(p_date date)
returns date
language sql
immutable
set search_path = ''
as $$
  select p_date - (extract(isodow from p_date)::int - 1);
$$;

-- Same as 0052, except an edit keeps a moved stop's day (see above).
create or replace function write_request_stop(
  p_group public.request_groups,
  p_request_id uuid,
  p_letter text,
  p_stop jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kept public.requests;
  v_kept_dest public.request_destinations;
  v_company boolean := p_group.form_type = 'COMPANY';
  v_label text := 'Stop ' || p_letter;
  v_project record;
  v_choice record;
  v_urgent_id text;
  v_urgent_name text := '';
  v_dest_id text;
  v_dest_name text;
  v_dest_is_other boolean := false;
  v_dest_other text := coalesce(trim(p_stop ->> 'destinationOther'), '');
  v_purpose_id text;
  v_purpose_name text;
  v_purpose_is_other boolean := false;
  v_purpose_other text := coalesce(trim(p_stop ->> 'purposeOther'), '');
  v_details text := coalesce(trim(p_stop ->> 'details'), '');
  v_flexibility text := coalesce(nullif(p_stop ->> 'flexibility', ''), 'DAY');
  v_fixed_time time(0);
  v_supplier_id text;
  v_supplier_name text := '';
  v_typed public.booking_options;
  v_request_id uuid := p_request_id;
  v_resend boolean := false;
  v_date date := p_group.requested_date;
  v_keep_move boolean := false;
begin
  if p_request_id is not null then
    select * into v_kept from public.requests where id = p_request_id;
    select * into v_kept_dest from public.request_destinations where request_id = p_request_id and active limit 1;
    -- A moved "any day that week" stop keeps its day while it stays in that week.
    v_keep_move := v_kept.moved_at is not null and v_flexibility = 'WEEK'
      and public.week_monday(v_kept.requested_date) = public.week_monday(p_group.requested_date);
    if v_keep_move then
      v_date := v_kept.requested_date;
    end if;
    v_resend := v_date is distinct from v_kept.requested_date
      or p_group.vehicle_plate is distinct from v_kept.vehicle_plate;
  end if;

  -- Project / Site: required on every stop (Daily may type Other).
  if v_company and coalesce(trim(p_stop ->> 'projectOther'), '') <> '' then
    raise exception '%: choose the Project / Site from the list', v_label using errcode = '22023';
  end if;
  select * into v_project from public.resolve_request_project(
    p_stop ->> 'projectId', p_stop ->> 'projectOther',
    case when v_kept.project_is_other then null else v_kept.project_id end, v_kept.project_name);
  if v_project.project_name = '' then
    raise exception '%: Project / Site is required', v_label using errcode = '22023';
  end if;

  -- Destination: from the list (not a Scheduler's fuel/errand stop), or
  -- typed on a Daily request (0049 turns a new name into a choice).
  if v_dest_other <> '' then
    if v_company then
      raise exception '%: choose the destination from the list', v_label using errcode = '22023';
    end if;
    v_typed := public.choice_for_typed_name('destinations', v_dest_other);
    if v_typed.id is not null then
      v_dest_id := v_typed.id;
      v_dest_name := v_typed.name;
    else
      v_dest_name := v_dest_other;
      v_dest_is_other := true;
    end if;
  else
    select o.id, o.name into v_dest_id, v_dest_name from public.booking_options o
    where o."group" = 'destinations' and o.id = nullif(p_stop ->> 'destinationId', '') and o.status = 'Active' and not o.is_other_stop;
    if v_dest_id is null and nullif(p_stop ->> 'destinationId', '') = v_kept_dest.destination_id then
      v_dest_id := v_kept_dest.destination_id;
      v_dest_name := v_kept_dest.destination_name;
    end if;
    if v_dest_id is null then
      raise exception '%: choose a destination', v_label using errcode = '22023';
    end if;
  end if;

  -- Urgent with a reason, or Regular with a purpose.
  if nullif(p_stop ->> 'urgentReasonId', '') is not null then
    select * into v_choice from public.resolve_choice('urgent_reasons', p_stop ->> 'urgentReasonId', 'Urgent reason',
      v_kept.urgent_reason_id, v_kept.urgent_reason_name);
    v_urgent_id := v_choice.id;
    v_urgent_name := v_choice.name;
    v_purpose_name := v_urgent_name;
  elsif v_purpose_other <> '' then
    if v_company then
      raise exception '%: choose the purpose from the list', v_label using errcode = '22023';
    end if;
    v_typed := public.choice_for_typed_name('purposes', v_purpose_other);
    if v_typed.id is not null then
      v_purpose_id := v_typed.id;
      v_purpose_name := v_typed.name;
    else
      v_purpose_name := v_purpose_other;
      v_purpose_is_other := true;
    end if;
  else
    select * into v_choice from public.resolve_choice('purposes', p_stop ->> 'purposeId', v_label || ': Purpose',
      v_kept_dest.purpose_id, v_kept_dest.purpose_name);
    v_purpose_id := v_choice.id;
    v_purpose_name := v_choice.name;
  end if;

  if v_details = '' and (v_urgent_id is not null or lower(v_purpose_name) in ('pick up', 'pickup', 'delivery')) then
    raise exception '%: add the details, e.g. what to pick up or deliver', v_label using errcode = '22023';
  end if;
  if char_length(v_details) > 150 then
    raise exception '%: details can be at most 150 characters', v_label using errcode = '22023';
  end if;

  if v_flexibility not in ('DAY', 'FIXED', 'WEEK') then
    raise exception '%: choose how flexible this stop is', v_label using errcode = '22023';
  end if;
  if v_flexibility = 'FIXED' then
    v_fixed_time := nullif(p_stop ->> 'fixedTime', '')::time(0);
    if v_fixed_time is null then
      raise exception '%: add the appointment time', v_label using errcode = '22023';
    end if;
  end if;

  if v_company then
    select * into v_choice from public.resolve_choice('suppliers', p_stop ->> 'supplierId', null,
      v_kept.supplier_id, v_kept.supplier_name);
    v_supplier_id := v_choice.id;
    v_supplier_name := v_choice.name;
  end if;

  if v_request_id is null then
    insert into public.requests (
      owner_account_id, owner_name, requested_date, request_type,
      project_id, project_name, project_is_other, vehicle_plate,
      group_id, stop_letter, urgent_reason_id, urgent_reason_name, details,
      flexibility, fixed_time, contact, supplier_id, supplier_name
    ) values (
      p_group.owner_account_id, p_group.owner_name, p_group.requested_date,
      case when v_urgent_id is null then 'REGULAR' else 'URGENT' end,
      v_project.project_id, v_project.project_name, v_project.project_is_other, p_group.vehicle_plate,
      p_group.id, p_letter, v_urgent_id, v_urgent_name, v_details,
      v_flexibility, v_fixed_time, left(coalesce(trim(p_stop ->> 'contact'), ''), 100), v_supplier_id, v_supplier_name
    ) returning id into v_request_id;
  else
    update public.requests set
      requested_date = v_date,
      moved_at = case when v_keep_move then moved_at end,
      moved_by_account_id = case when v_keep_move then moved_by_account_id end,
      request_type = case when v_urgent_id is null then 'REGULAR' else 'URGENT' end,
      project_id = v_project.project_id,
      project_name = v_project.project_name,
      project_is_other = v_project.project_is_other,
      vehicle_plate = p_group.vehicle_plate,
      urgent_reason_id = v_urgent_id,
      urgent_reason_name = v_urgent_name,
      details = v_details,
      flexibility = v_flexibility,
      fixed_time = v_fixed_time,
      contact = left(coalesce(trim(p_stop ->> 'contact'), ''), 100),
      supplier_id = v_supplier_id,
      supplier_name = v_supplier_name,
      -- A new date or vehicle makes a sent-back stop a fresh request again
      -- (0050); on the right of SET these columns still hold the old values.
      sent_back_at = case when v_resend then null else sent_back_at end,
      sent_back_by_account_id = case when v_resend then null else sent_back_by_account_id end,
      sent_back_reason = case when v_resend then '' else sent_back_reason end,
      row_version = row_version + 1,
      updated_at = now()
    where id = v_request_id;
    update public.request_destinations set active = false where request_id = v_request_id and active;
  end if;

  insert into public.request_destinations (
    request_id, position, destination_id, destination_name, destination_is_other,
    purpose_id, purpose_name, purpose_is_other
  ) values (
    v_request_id, 1, v_dest_id, v_dest_name, v_dest_is_other,
    v_purpose_id, v_purpose_name, v_purpose_is_other
  );
  return v_request_id;
end;
$$;

-- Moves an unscheduled "any day that week" stop to another day of the week
-- it was asked for (Monday to Saturday, not before today), and tells the
-- requester. Scheduler, or Admin acting as Scheduler.
create function move_request_day(p_request_id uuid, p_date date)
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
  if v_request.flexibility <> 'WEEK' or v_group.id is null then
    raise exception 'Only a stop the requester marked "Any day that week" can be moved' using errcode = '22023';
  end if;
  if exists (select 1 from public.schedule_requests where request_id = p_request_id and active) then
    raise exception 'This stop is already in a schedule; remove it from that schedule first' using errcode = '22023';
  end if;
  if p_date is null
     or public.week_monday(p_date) <> public.week_monday(v_group.requested_date)
     or extract(isodow from p_date) = 7 then
    raise exception 'Pick a day from Monday to Saturday of the week the requester asked for' using errcode = '22023';
  end if;
  if p_date < v_today then
    raise exception 'That day has passed' using errcode = '22023';
  end if;
  if p_date = v_request.requested_date then
    return v_request;
  end if;

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
      format('Stop %s-%s is now on %s. You said any day that week would do',
        v_group.number, v_request.stop_letter, to_char(p_date, 'FMDay, FMMonth FMDD')),
      v_request.id
    );
  end if;
  return v_request;
end;
$$;

revoke execute on function move_request_day(uuid, date) from public, anon;
grant execute on function move_request_day(uuid, date) to authenticated;

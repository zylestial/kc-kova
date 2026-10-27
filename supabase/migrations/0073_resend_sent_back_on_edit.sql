-- A requester's save puts a sent-back request back in the Scheduler's pool,
-- whatever changed. Until now only a new date (0038) or vehicle (0050) did,
-- but a Scheduler also sends requests back for details to fix, and a tester
-- who fixed those and saved saw it stay sent back.
--
-- The request still needs a day that hasn't passed: a sent-back request on
-- a past date must be moved before it can go back (Admin excepted, as for
-- any past date).

-- write_request_stop: same as 0053, but editing a stop always clears its
-- send-back, and a sent-back stop can't be resent for a past day.
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
    if v_kept.sent_back_at is not null and v_date < (now() at time zone 'Asia/Manila')::date
       and not exists (select 1 from public.accounts where id = auth.uid() and role = 'Admin') then
      raise exception '%: that day has passed. Choose a new date to send it to the Scheduler again', v_label using errcode = '22023';
    end if;
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
      -- Any save makes a sent-back stop a fresh request again.
      sent_back_at = null,
      sent_back_by_account_id = null,
      sent_back_reason = '',
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

-- update_request: same as 0051, but saving always clears the send-back,
-- and a sent-back request can't be resent for a past day.
create or replace function update_request(
  p_request_id uuid,
  p_expected_row_version integer,
  p_requested_date date,
  p_request_type text,
  p_project_id text,
  p_project_other text,
  p_destinations jsonb,
  p_vehicle_plate text
) returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_existing public.requests;
  v_kept jsonb;
  v_project record;
  v_plate text;
  v_request public.requests;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if not public.can_request_transport(v_actor) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_existing from public.requests where id = p_request_id for update;
  if v_existing is null or v_existing.owner_account_id <> v_actor.id then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_existing.status <> 'ACTIVE' then
    raise exception 'This request has been cancelled' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.schedule_requests where request_id = p_request_id and active
  ) then
    raise exception 'This request is already being scheduled and can no longer be edited' using errcode = '22023';
  end if;
  if v_existing.row_version <> p_expected_row_version then
    raise exception 'This request was changed elsewhere. Reload it and try again' using errcode = 'PT409';
  end if;

  if v_existing.requested_date is distinct from p_requested_date
     or v_existing.request_type is distinct from p_request_type then
    perform public.check_request_date(v_actor.role, p_requested_date, p_request_type);
  end if;
  if v_existing.sent_back_at is not null and v_actor.role <> 'Admin'
     and p_requested_date < (now() at time zone 'Asia/Manila')::date then
    raise exception 'That day has passed. Choose a new date to send it to the Scheduler again' using errcode = '22023';
  end if;
  select * into v_project from public.resolve_request_project(
    p_project_id, p_project_other,
    case when v_existing.project_is_other then null else v_existing.project_id end,
    v_existing.project_name
  );
  v_plate := public.resolve_request_vehicle(p_vehicle_plate, v_existing.vehicle_plate);

  select coalesce(jsonb_agg(jsonb_build_object(
    'destination_id', destination_id, 'destination_name', destination_name,
    'purpose_id', purpose_id, 'purpose_name', purpose_name
  )), '[]') into v_kept
  from public.request_destinations
  where request_id = p_request_id and active;

  perform set_config('kova.audit_action', 'request.update', true);

  update public.request_destinations set active = false
  where request_id = p_request_id and active;
  perform public.insert_request_destinations(p_request_id, p_destinations, v_kept);

  update public.requests set
    requested_date = p_requested_date,
    request_type = p_request_type,
    project_id = v_project.project_id,
    project_name = v_project.project_name,
    project_is_other = v_project.project_is_other,
    vehicle_plate = v_plate,
    sent_back_at = null,
    sent_back_by_account_id = null,
    sent_back_reason = '',
    row_version = row_version + 1,
    updated_at = now()
  where id = p_request_id
  returning * into v_request;

  return v_request;
end;
$$;

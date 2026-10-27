-- A sent-back stop can go on another day while the rest of its request is
-- being scheduled (2026-10-27). Until now the request's date was locked as
-- soon as any stop was being scheduled (0052), so a stop the Scheduler sent
-- back could keep only its old day, and once that day passed it couldn't be
-- sent again at all (0073): cancelling and asking again was the only way.
--
-- move_sent_back_stop: the requester moves their sent-back stop to a new
-- day. It becomes a request of its own (a new number, stop A) with the
-- same form and trip details, so later edits to either request leave the
-- other alone, and it goes back to the Scheduler's pool. Only while another
-- stop of the request is being scheduled; otherwise the requester simply
-- edits the request's date.

create function move_sent_back_stop(p_request_id uuid, p_date date)
returns public.request_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_request public.requests;
  v_group public.request_groups;
  v_new public.request_groups;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if not public.can_request_transport(v_actor) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select * into v_request from public.requests where id = p_request_id for update;
  if v_request.id is null or v_request.owner_account_id <> v_actor.id or v_request.group_id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  select * into v_group from public.request_groups where id = v_request.group_id for update;
  if v_request.status <> 'ACTIVE' then
    raise exception 'This stop was cancelled. Reload and try again' using errcode = '22023';
  end if;
  if v_request.sent_back_at is null then
    raise exception 'Only a stop the Scheduler sent back can be moved this way' using errcode = '22023';
  end if;
  if exists (select 1 from public.schedule_requests where request_id = p_request_id and active) then
    raise exception 'This stop is already being scheduled again. Reload and try again' using errcode = 'PT409';
  end if;
  if not exists (
    select 1 from public.schedule_requests sr join public.requests r on r.id = sr.request_id
    where r.group_id = v_group.id and sr.active
  ) then
    raise exception 'Edit the request to change its date' using errcode = '22023';
  end if;
  if p_date is null then
    raise exception 'Pick a day' using errcode = '22023';
  end if;
  if p_date < v_today and v_actor.role <> 'Admin' then
    raise exception 'That day has passed. Pick today or a later day' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'request.move_sent_back', true);

  insert into public.request_groups (
    owner_account_id, owner_name, form_type, requested_date,
    starting_point_id, starting_point_name, department_id, department_name,
    vehicle_plate, driver_id, driver_name, supervisor_id, supervisor_name,
    head_id, head_name, site_officer, site_company
  ) values (
    v_group.owner_account_id, v_group.owner_name, v_group.form_type, p_date,
    v_group.starting_point_id, v_group.starting_point_name, v_group.department_id, v_group.department_name,
    v_group.vehicle_plate, v_group.driver_id, v_group.driver_name, v_group.supervisor_id, v_group.supervisor_name,
    v_group.head_id, v_group.head_name, v_group.site_officer, v_group.site_company
  ) returning * into v_new;

  -- Back in the pool on its new day, as any requester's save does (0073).
  update public.requests set
    group_id = v_new.id,
    stop_letter = 'A',
    requested_date = p_date,
    moved_at = null,
    moved_by_account_id = null,
    missed_at = null,
    sent_back_at = null,
    sent_back_by_account_id = null,
    sent_back_reason = '',
    row_version = row_version + 1,
    updated_at = now()
  where id = p_request_id;

  update public.request_groups set row_version = row_version + 1, updated_at = now() where id = v_group.id;
  return v_new;
end;
$$;

revoke execute on function move_sent_back_stop(uuid, date) from public, anon;
grant execute on function move_sent_back_stop(uuid, date) to authenticated;

-- A Scheduler or Admin deletes a request permanently (owner's call
-- 2026-11-18), mostly to clear stops left from past days that nobody
-- planned. One stop at a time; the requester isn't told.
--
-- This is the one exception to "nothing is hard-deleted": the stop's rows
-- are erased, and only audit_events keeps a record (each delete writes the
-- row as it was, with who did it). A stop that was ever on a trip can't be
-- deleted, because the trip's history (revisions, legs, taps, tasks,
-- reports) points at it; a missed stop is sent back or moved instead.
--
--   delete_request(p_request_id)   Erases the stop, its destinations, its
--                                  cancellation asks and its bell
--                                  notifications, and its request group
--                                  once no stop is left. Otherwise the
--                                  group's row_version goes up, so the
--                                  requester's open edit form is stale.

create function delete_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_request public.requests;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' or v_actor.role not in ('Scheduler', 'Admin') then
    raise exception 'Only a Scheduler or Admin can delete a request' using errcode = '42501';
  end if;

  -- Lock order: group, then stop, as update_request_group takes them.
  perform 1 from public.request_groups
  where id = (select group_id from public.requests where id = p_request_id)
  for update;
  select * into v_request from public.requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_request.missed_at is not null
     or exists (select 1 from public.schedule_requests where request_id = p_request_id)
     or exists (select 1 from public.revision_requests where request_id = p_request_id) then
    raise exception 'This stop was on a trip, so it can''t be deleted. Send it back or move it instead' using errcode = '22023';
  end if;

  perform set_config('kova.audit_action', 'request.delete', true);
  perform set_config('kova.audit_is_override', (v_actor.role = 'Admin')::text, true);

  delete from public.notifications where related_request_id = p_request_id;
  delete from public.request_cancellations where request_id = p_request_id;
  delete from public.request_destinations where request_id = p_request_id;
  delete from public.requests where id = p_request_id;

  if v_request.group_id is not null then
    if exists (select 1 from public.requests where group_id = v_request.group_id) then
      update public.request_groups set row_version = row_version + 1, updated_at = now()
      where id = v_request.group_id;
    else
      delete from public.request_groups where id = v_request.group_id;
    end if;
  end if;
end;
$$;

revoke execute on function delete_request(uuid) from public, anon;
grant execute on function delete_request(uuid) to authenticated;

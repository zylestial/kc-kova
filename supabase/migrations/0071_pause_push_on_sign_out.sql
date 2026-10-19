-- Phone notifications, part 3: signing out pauses a device instead of
-- forgetting it, so signing back in can show what arrived meanwhile.
--
-- A paused device gets no pushes (0070's trigger skips it). Saving it again
-- for the same account un-pauses it and returns when it was paused, and
-- /api/push/subscription sends it the unread notifications since then.
-- Saving it for another account starts fresh: that account wasn't here.

alter table push_subscriptions add column paused_at timestamptz;

-- Same as 0069, plus un-pausing; returns when it was paused, for this
-- account, or null.
drop function save_push_subscription(text, text, text, text);
create function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
  v_paused_at timestamptz;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'This device''s push details are incomplete' using errcode = '22023';
  end if;

  select paused_at into v_paused_at from public.push_subscriptions
  where endpoint = p_endpoint and account_id = v_actor.id
  for update;

  insert into public.push_subscriptions (account_id, endpoint, p256dh, auth, user_agent)
  values (v_actor.id, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update set
    account_id = excluded.account_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    paused_at = null;

  return v_paused_at;
end;
$$;

revoke execute on function save_push_subscription(text, text, text, text) from public, anon;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;

-- On sign-out: this device stops getting the account's pushes until it
-- signs in again.
create function pause_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.push_subscriptions set paused_at = coalesce(paused_at, now())
  where endpoint = p_endpoint and account_id = auth.uid();
end;
$$;

revoke execute on function pause_push_subscription(text) from public, anon;
grant execute on function pause_push_subscription(text) to authenticated;

-- Same as 0070, but a paused device doesn't count.
create or replace function push_new_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.push_subscriptions where account_id = new.account_id and paused_at is null
  ) then
    return null;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_send_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_send_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('notificationId', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  raise warning 'Phone notification not queued for %: %', new.id, sqlerrm;
  return null;
end;
$$;

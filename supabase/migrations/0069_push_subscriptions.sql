-- Phone notifications (Web Push): one row per device that turned them on.
--
-- A device is its browser's push endpoint, so it belongs to one account at
-- a time: turning push on again from another account on the same device
-- moves the row to that account. Written only through the two RPCs below;
-- the sender (/api/push/send) reads it with the service-role client.

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts (id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

create index push_subscriptions_account_id_idx on push_subscriptions (account_id);

alter table push_subscriptions enable row level security;

grant select on push_subscriptions to authenticated;

create policy push_subscriptions_select on push_subscriptions for select
  using (account_id = (select auth.uid()));

-- Saves this device for the signed-in account, or moves it here from
-- whoever had it before.
create function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.accounts;
begin
  select * into v_actor from public.accounts where id = auth.uid();
  if v_actor is null or v_actor.status <> 'Active' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'This device''s push details are incomplete' using errcode = '22023';
  end if;

  insert into public.push_subscriptions (account_id, endpoint, p256dh, auth, user_agent)
  values (v_actor.id, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update set
    account_id = excluded.account_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent;
end;
$$;

revoke execute on function save_push_subscription(text, text, text, text) from public, anon;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;

-- Turns push off for this device, if it's the signed-in account's.
create function remove_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_subscriptions
  where endpoint = p_endpoint and account_id = auth.uid();
end;
$$;

revoke execute on function remove_push_subscription(text) from public, anon;
grant execute on function remove_push_subscription(text) to authenticated;

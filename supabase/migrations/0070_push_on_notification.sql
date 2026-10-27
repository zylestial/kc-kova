-- Phone notifications (Web Push), part 2: every new notifications row is
-- also sent to the recipient's devices (0069).
--
-- The trigger only asks: it posts the row's id to KOVA's /api/push/send
-- through pg_net, which sends after the transaction commits (a rolled-back
-- action sends nothing). The URL and the shared secret live in Vault, set
-- once per environment:
--
--   select vault.create_secret('https://<app>/api/push/send', 'push_send_url');
--   select vault.create_secret('<same as PUSH_SEND_SECRET>', 'push_send_secret');
--
-- Until both exist, nothing is sent. A failure here never fails the action
-- that made the notification; the bell still has it.

create extension if not exists pg_net with schema extensions;

create function push_new_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.push_subscriptions where account_id = new.account_id) then
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

revoke execute on function push_new_notification() from public, anon, authenticated;

create trigger notifications_push
  after insert on notifications
  for each row execute function push_new_notification();

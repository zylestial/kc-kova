-- Rate limits counted in one step (2026-10-27). lib/supabase/login-rate-limit.ts
-- read a key's count and then wrote count + 1 in a second call, so requests
-- sent at the same moment all read the same count and none was refused:
-- fifty sign-ins in parallel each got their try, whatever the limit.
--
-- add_login_attempts adds to a key's count and returns the new count in one
-- statement. The upsert locks the row, so parallel calls queue up and each
-- sees the count the call before it left. A window that has run out starts
-- again from this call. `p_by` may be negative to give attempts back (a
-- successful sign-in from a shared network); the count never goes below 0.
-- Only the service-role client calls it, as only it touches login_attempts.

create function add_login_attempts(p_key text, p_by integer, p_window_seconds integer)
returns integer
language sql
set search_path = ''
as $$
  insert into public.login_attempts as a (key, count, window_start)
  values (p_key, greatest(p_by, 0), now())
  on conflict (key) do update set
    count = case
      when a.window_start <= now() - make_interval(secs => p_window_seconds) then greatest(p_by, 0)
      else greatest(a.count + p_by, 0)
    end,
    window_start = case
      when a.window_start <= now() - make_interval(secs => p_window_seconds) then now()
      else a.window_start
    end
  returning count;
$$;

revoke execute on function add_login_attempts(text, integer, integer) from public, anon, authenticated;
grant execute on function add_login_attempts(text, integer, integer) to service_role;

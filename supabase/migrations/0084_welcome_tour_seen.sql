-- The welcome tour (2026-10-30, owner's call): a step-by-step dialog with
-- screenshots of each role's screens opens by itself on an account's
-- first sign-in. Skip tour or Done marks it seen for that account on
-- every device; Help in the menu opens it again any time.
--
-- tour_seen_at: when the account first closed the tour; null = not yet.
-- Existing accounts start at null, so everyone sees it once.
--
-- mark_tour_seen: the signed-in account marks its own tour seen. Accounts
-- are otherwise changed only by an Admin, so this is its own function and
-- touches nothing but this column. Marking it again keeps the first time.

alter table accounts add column tour_seen_at timestamptz;

create function mark_tour_seen()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen timestamptz;
begin
  update public.accounts set tour_seen_at = coalesce(tour_seen_at, now())
  where id = auth.uid() and status = 'Active'
  returning tour_seen_at into v_seen;
  if v_seen is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return v_seen;
end;
$$;

revoke execute on function mark_tour_seen() from public, anon;
grant execute on function mark_tour_seen() to authenticated;

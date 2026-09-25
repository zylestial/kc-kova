-- v2.0 roles, step 1 of 2 (expand).
--
-- v2 has exactly four account types: Requester, Scheduler, Admin, Driver.
-- Requester replaces Booker outright (a full rename, not an alias) and
-- Scheduler is net-new. This migration only *widens* the role check so
-- both the old and new values are valid at once: v1.2 code, which only
-- knows Booker, keeps working while this is applied. The Booker -> Requester
-- data conversion and the removal of Booker from the constraint happen in
-- a later, separately released migration (see docs/v2/phase-3-schema.md).

alter table accounts drop constraint accounts_role_check;
alter table accounts add constraint accounts_role_check
  check (role in ('Booker', 'Requester', 'Scheduler', 'Driver', 'Admin'));

-- Role of the calling account, or null if the caller has no account or the
-- account is Inactive. Used by the v2 RLS policies so each one reads as a
-- plain role test. security definer so it can read accounts regardless of
-- the caller's own row-level access (same reasoning as is_admin()).
create function current_account_role()
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select role from public.accounts
  where id = (select auth.uid()) and status = 'Active';
$$;

revoke execute on function current_account_role() from public;
revoke execute on function current_account_role() from anon;
grant execute on function current_account_role() to authenticated;

-- A Finance account type (owner's request, 2026-10-20): it reads
-- Schedules, Finished Trips and Attendance, prints the trip forms and
-- downloads them, but changes nothing. Read access comes in a later
-- migration; this one only lets the account exist. Like a Scheduler (0074),
-- an Admin can let a Finance account make Daily or Company requests with
-- the two switches, both off by default.

alter table accounts drop constraint accounts_role_check;
alter table accounts add constraint accounts_role_check
  check (role in ('Requester', 'Scheduler', 'Admin', 'Driver', 'Finance'));

alter table account_invites drop constraint account_invites_role_check;
alter table account_invites add constraint account_invites_role_check
  check (role in ('Requester', 'Scheduler', 'Admin', 'Driver', 'Finance'));

-- The Daily switch belongs to Drivers, Schedulers and Finance; anyone else loses it.
create or replace function normalize_driver_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'Driver' then
    new.driver_type := coalesce(new.driver_type, 'Truck');
  else
    new.driver_type := null;
    if new.role not in ('Scheduler', 'Finance') then
      new.can_request_daily := false;
    end if;
  end if;
  return new;
end;
$$;

alter table accounts
  drop constraint accounts_daily_switch_roles,
  drop constraint accounts_company_switch_roles,
  add constraint accounts_daily_switch_roles check (not can_request_daily or role in ('Driver', 'Scheduler', 'Finance')),
  add constraint accounts_company_switch_roles check (
    not can_request_company or role in ('Requester', 'Admin', 'Driver', 'Scheduler', 'Finance')
  );

-- lib/request-access.ts mirrors these two for the menus.
create or replace function can_request_daily(p_account public.accounts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_account.id is not null
    and p_account.status = 'Active'
    and (
      p_account.role in ('Requester', 'Admin')
      or (p_account.can_request_daily
          and (p_account.role in ('Scheduler', 'Finance')
               or (p_account.role = 'Driver' and p_account.driver_type = 'Company car')))
    );
$$;

create or replace function can_request_company(p_account public.accounts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_account.id is not null
    and p_account.status = 'Active'
    and (
      p_account.role = 'Admin'
      or (p_account.can_request_company
          and (p_account.role in ('Requester', 'Scheduler', 'Finance')
               or (p_account.role = 'Driver' and p_account.driver_type = 'Company car')))
    );
$$;

revoke execute on function can_request_daily(public.accounts) from public, anon, authenticated;
revoke execute on function can_request_company(public.accounts) from public, anon, authenticated;

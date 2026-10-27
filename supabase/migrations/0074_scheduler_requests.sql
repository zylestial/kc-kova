-- Schedulers may make requests when an Admin allows it (owner's call,
-- 2026-10-20): the same two switches as a Company car Driver, "Can make
-- Daily Vehicle Trip requests" and "Can request company trips", each off
-- until an Admin turns it on. Company trips still need a Position. A
-- Scheduler may plan a trip that has their own request on it; the Admin
-- still approves it. Everything else is as in 0051 and 0059.

-- The Daily switch now belongs to Drivers and Schedulers; anyone else loses it.
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
    if new.role <> 'Scheduler' then
      new.can_request_daily := false;
    end if;
  end if;
  return new;
end;
$$;

alter table accounts
  drop constraint accounts_daily_switch_drivers_only,
  drop constraint accounts_company_switch_roles,
  -- Requesters and Admins always can make Daily requests, so the switch only means something here.
  add constraint accounts_daily_switch_roles check (not can_request_daily or role in ('Driver', 'Scheduler')),
  add constraint accounts_company_switch_roles check (
    not can_request_company or role in ('Requester', 'Admin', 'Driver', 'Scheduler')
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
          and (p_account.role = 'Scheduler' or (p_account.role = 'Driver' and p_account.driver_type = 'Company car')))
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
          and (p_account.role in ('Requester', 'Scheduler')
               or (p_account.role = 'Driver' and p_account.driver_type = 'Company car')))
    );
$$;

revoke execute on function can_request_daily(public.accounts) from public, anon, authenticated;
revoke execute on function can_request_company(public.accounts) from public, anon, authenticated;

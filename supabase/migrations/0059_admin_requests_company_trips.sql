-- Every active Admin may make Company Trip requests (owner's call,
-- 2026-10-16), without the "Can request company trips" switch. Requesters
-- and Company car Drivers still need it. An Admin's Position prints on the
-- form if set, and is blank otherwise. Everything else is as in 0051.

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
          and (p_account.role = 'Requester' or (p_account.role = 'Driver' and p_account.driver_type = 'Company car')))
    );
$$;

revoke execute on function can_request_company(public.accounts) from public, anon, authenticated;

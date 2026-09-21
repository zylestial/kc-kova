-- Two changes to every existing RLS policy, both semantics-preserving:
--
-- 1. `for all` admin-write policies become three explicit policies
--    (insert/update/delete), each carrying the exact same using/with check
--    predicate the `for all` policy applied to that operation. `for all` is
--    shorthand for "this predicate applies to select/insert/update/delete";
--    splitting it out doesn't change what's allowed, it just makes each
--    operation's rule independently readable and auditable.
-- 2. Every `auth.uid()` / `auth.role()` call is wrapped as
--    `(select auth.uid())` / `(select auth.role())`. Per Supabase's RLS
--    performance guidance, an unwrapped call is re-evaluated per row
--    scanned; wrapping it lets Postgres evaluate it once per statement
--    (an initplan) and reuse the result. Same result, cheaper on any
--    query that touches more than one row.
--
-- Default-deny is unaffected: no table gets a new grant here, and every
-- table still has RLS enabled from 0001_init.sql.

-- accounts ------------------------------------------------------------
drop policy accounts_select on accounts;
create policy accounts_select on accounts for select
  using ((select auth.role()) = 'authenticated');

drop policy accounts_admin_write on accounts;
create policy accounts_admin_insert on accounts for insert
  with check (is_admin((select auth.uid())));
create policy accounts_admin_update on accounts for update
  using (is_admin((select auth.uid())))
  with check (is_admin((select auth.uid())));
create policy accounts_admin_delete on accounts for delete
  using (is_admin((select auth.uid())));

-- vehicles --------------------------------------------------------------
drop policy vehicles_select on vehicles;
create policy vehicles_select on vehicles for select
  using ((select auth.role()) = 'authenticated');

drop policy vehicles_admin_write on vehicles;
create policy vehicles_admin_insert on vehicles for insert
  with check (is_admin((select auth.uid())));
create policy vehicles_admin_update on vehicles for update
  using (is_admin((select auth.uid())))
  with check (is_admin((select auth.uid())));
create policy vehicles_admin_delete on vehicles for delete
  using (is_admin((select auth.uid())));

-- vehicle_aliases ---------------------------------------------------------
drop policy vehicle_aliases_select on vehicle_aliases;
create policy vehicle_aliases_select on vehicle_aliases for select
  using ((select auth.role()) = 'authenticated');

drop policy vehicle_aliases_admin_write on vehicle_aliases;
create policy vehicle_aliases_admin_insert on vehicle_aliases for insert
  with check (is_admin((select auth.uid())));
create policy vehicle_aliases_admin_update on vehicle_aliases for update
  using (is_admin((select auth.uid())))
  with check (is_admin((select auth.uid())));
create policy vehicle_aliases_admin_delete on vehicle_aliases for delete
  using (is_admin((select auth.uid())));

-- booking_options ---------------------------------------------------------
drop policy booking_options_select on booking_options;
create policy booking_options_select on booking_options for select
  using ((select auth.role()) = 'authenticated');

drop policy booking_options_admin_write on booking_options;
create policy booking_options_admin_insert on booking_options for insert
  with check (is_admin((select auth.uid())));
create policy booking_options_admin_update on booking_options for update
  using (is_admin((select auth.uid())))
  with check (is_admin((select auth.uid())));
create policy booking_options_admin_delete on booking_options for delete
  using (is_admin((select auth.uid())));

-- people ------------------------------------------------------------------
drop policy people_select on people;
create policy people_select on people for select
  using ((select auth.role()) = 'authenticated');

drop policy people_admin_write on people;
create policy people_admin_insert on people for insert
  with check (is_admin((select auth.uid())));
create policy people_admin_update on people for update
  using (is_admin((select auth.uid())))
  with check (is_admin((select auth.uid())));
create policy people_admin_delete on people for delete
  using (is_admin((select auth.uid())));

-- bookings (select-only; writes are RPC-only, see 0002/0006) -------------
drop policy bookings_select on bookings;
create policy bookings_select on bookings for select
  using (
    driver_id = (select auth.uid())
    or requested_by_account_id = (select auth.uid())
    or created_by_account_id = (select auth.uid())
    or exists (
      select 1 from accounts
      where id = (select auth.uid()) and role in ('Booker', 'Admin') and status = 'Active'
    )
  );

-- vehicle_records (select-only; writes are app-code + service-role, see
-- app/api/records/[recordId]/route.ts and docs/MEMORY.md) ----------------
drop policy vehicle_records_select on vehicle_records;
create policy vehicle_records_select on vehicle_records for select
  using (
    exists (
      select 1 from bookings b
      where b.id = (data->>'bookingId')::uuid
        and (
          b.driver_id = (select auth.uid())
          or b.created_by_account_id = (select auth.uid())
          or exists (
            select 1 from accounts
            where id = (select auth.uid()) and role = 'Admin' and status = 'Active'
          )
        )
    )
  );

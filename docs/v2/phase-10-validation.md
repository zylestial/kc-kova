# KOVA v2.0 — Phase 10: End-to-end validation and cutover rehearsal

Branch `feat/v2-validation`, from `feat/v2-scheduling` after #36 (Phases 7 to
9b) merged. Local Docker database only; no app code changed.

## 1. Scope

Phase 9b removed the v1.2 booking tables, so there are no legacy bookings to
carry into v2. Phase 10 is therefore two things: an end-to-end run of the v2
workflow, and a rehearsal of the cutover order (backup, apply 0023 to 0032
together, verify, roll back) on a database shaped like v1.2.

## 2. Cutover rehearsal

1. Reset to migration 0022 (`supabase db reset --version 0022`) so the
   database looks like v1.2 with the additive v2 tables.
2. Seed v1.2-shaped rows: an Admin, two Bookers, a Driver, a vehicle with an
   assigned Driver, one booking with two slots and one Daily Vehicle Record.
3. Back up with `pg_dump -Fc`, then apply everything pending with
   `supabase migration up` (0023 to 0032 in one run).
4. Verify: both Bookers are now Requesters, all four auth users and the
   vehicle's Driver assignment are intact, and `bookings`, `booking_slots`,
   `vehicle_records` and `vehicle_aliases` are gone.
5. Roll back by resetting to a fresh 0022 schema and loading the backup's
   data (`pg_restore --data-only` as `supabase_admin`). Accounts came back as
   Bookers, with the booking, both slots, the record and all four auth users.
6. Apply 0023 to 0032 again on the restored data; it succeeds.

### Findings

- **`pg_restore --clean` over a live migrated database is not a rollback.**
  It only drops objects that are in the dump, so functions added after the
  backup (for example the three-argument `insert_request_destinations` from
  0024) survive, and the next forward migration fails with "function already
  exists". Restore into a fresh database instead. On hosted Supabase that
  means the dashboard backup restore or point-in-time recovery, which replaces
  the whole database. Phase 11's rollback runbook must say so.
- **A failed backup must stop the run.** The first attempt's `pg_dump` wrote
  nowhere (Git Bash rewrote the `/tmp` path) and the migration step ran
  anyway. Confirm the dump file is non-empty before applying migrations.
- **`db reset` restarts the container and clears `/tmp`** inside it, so keep
  the dump on the host and copy it back in.

## 3. End-to-end run

41 HTTP checks against the running app on the rehearsal database, signing in
through `/api/auth/sign-in` as each role. All passed.

- **Converted accounts:** a v1.2 Booker signs in as a Requester with the
  password it had before 0023.
- **Setup:** Admin creates Booking Options and a Scheduler account.
- **Request to approval:** Requester files a two-destination request; the
  Scheduler sees it and another Requester does not; the Scheduler builds a
  draft with a return leg, submits it and cannot approve it (403); the Admin
  approves; the Driver sees the published schedule; request progress reads
  APPROVED.
- **Finished trip:** completion is refused before the trip has ended (422). Once
  it has, the Driver submits odometer readings and reports a problem; a
  Requester cannot submit and a Scheduler cannot mark Done (403); the Admin
  corrects the odometer (distance 60), handles the problem, and marks Done.
  Handling and marking Done are idempotent, and a correction after Done is
  refused (422).
- **Cancellation:** the owning Requester asks to cancel a request a schedule
  holds; another Requester cannot; the Admin confirms and the request reads
  CANCELLED.
- **Removed and locked down:** an anonymous bootstrap returns 401, and
  `/api/bookings` and `/api/records/*` return 404.

To test completion, one trip's dates were moved into the past directly in the
database (`schedules.schedule_date`, `requests.requested_date` and the
`schedule_reservations.period` range), because the app cannot create a past
trip.

After the rehearsal, on a fresh reset: pgTAP 230/230, vitest 80/80, `tsc`
clean, `lint` 0 errors (one existing `<img>` warning), `next build` passes.

## 4. Not covered

- **Browser and print.** The run was over HTTP. Screens, the finished-trip
  print form and mobile layout were not driven this phase (the Phase 9
  Playwright walkthrough is the last time they were).
- **Concurrency script.** It lives outside the repo and was not available.
- **Hosted environments.** Nothing touched the hosted Supabase project or
  Vercel; both belong to Phase 11.
- **The role-reversal SQL** in `phase-3-schema.md` section 7 was not run.
  After 0032 the rollback is a backup restore, which is what was rehearsed.
- **Real data.** Rows were seeded; production row counts are still to be
  confirmed before Phase 11, as `baseline.md` says.

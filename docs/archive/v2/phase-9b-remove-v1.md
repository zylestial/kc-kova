# KOVA v2.0 — Phase 9b: Remove the v1.2 screens, code and tables

Branch `chore/v2-remove-v1`, stacked on `feat/v2-finished-trips` (Phase 9).
Done before Phase 10 so the end-to-end validation and migration rehearsal
run against v2 only. Local Docker database only.

## 1. Decisions

- **Drop the v1.2 tables, not just the code.** There is no legacy data to
  carry over, so the bookings, booking slots and Daily Vehicle Records are
  dropped instead of migrated. This replaces Phase 10's plan to carry legacy
  bookings into v2.
- **`vehicle_aliases` goes too.** Only `rename_vehicle` wrote to it, and
  nothing read it. It only existed to resolve old plates in v1 records.
- **`rename_vehicle` is rewritten, not dropped.** It still moves a plate
  across `vehicles`, `schedule_revisions` and `schedule_reservations`.
- **Kept:** `booking_options` and `people` (requests use them),
  `login_attempts`, and everything under requests, schedules, completions,
  problems and audit.
- **Release-time only.** 0032 drops data for good and removes tables the
  live v1.2 app uses, so it is applied at cutover with 0023, not ahead of
  it. Going back to v1.2 afterwards needs a restore from the pre-cutover
  backup (recorded in `phase-3-schema.md`).
- **No v2 rule is lost.** The v1 trigger blocking bookings on an Inactive
  vehicle is replaced by the checks already in `save_schedule_draft` and
  `approve_schedule`. The one-driver-per-vehicle-per-day trigger is
  dropped without a replacement: it existed so one Driver filed one Daily
  Vehicle Record per vehicle per day, and a v2 completion belongs to a single
  schedule. Two schedules for one vehicle on one day can now have different
  Drivers if the vehicle's assigned Driver changes between them.

## 2. What was removed

| Area | Removed |
|---|---|
| Screens | `scheduler.tsx` (Admin Schedule grid and Daily Vehicle Record editor with its `PrintForm`), `booking-flow.tsx`, `admin-booking-approvals.tsx`, `record-history.tsx`, `review-trip.tsx`, and the Schedule and Booking Approvals buttons and pending-count badge in `page.tsx` |
| API | `/api/bookings` (create, update, cancel, approve, deny), `/api/records/[recordId]`, `lib/supabase/records.ts` |
| Client | `Booking`, `VehicleRecord` and `HistoryEntry` types, the booking and record getters and save calls, `canManageBooking`, `canFinishTrip`, `validateDriverSubmission`, and `bookings` / `records` in the bootstrap cache |
| Bootstrap | the `bookings` and `vehicle_records` queries and mappers |
| Database (0032) | tables `bookings`, `booking_slots`, `vehicle_records`, `vehicle_aliases`; functions `create_booking`, `update_booking`, `cancel_booking`, `approve_booking`, `deny_booking`, `enforce_same_daily_driver`, `block_inactive_vehicle` |
| Tests | `lib/kova-api.test.ts`, `lib/supabase/records.test.ts`, and the booking and record mapper tests |

Other edits: "bookings" wording in Booking Options now says "requests", and
ARCHITECTURE, DESIGN, RULES, BACKEND_INTEGRATION and the Phase 3/5 notes were
updated to match. The DESIGN print section now describes the finished-trip
form.

## 3. Not done

- **Dead CSS** for the removed screens (`.booking-flow` and similar) is still
  in `app/globals.css`. It is minified onto a few very long lines and shared
  with the request and planner screens, so it needs a careful pass of its own.
- Historical TASKS entries still describe the v1 features as they were built.
- The Settings tab and its components are still called "Booking Options",
  the name of the table that stays.

## 4. Verification

On a fresh local reset:

- pgTAP **230/230** (six files, was 214). The new `v2_v1_retired.test.sql`
  (16) checks the four tables and seven functions are gone and the ones v2
  needs are kept; the existing `rename_vehicle` coverage in
  `v2_schedules.test.sql` passes against the rewrite.
- Concurrency script: all checks pass.
- vitest **80/80** (was 121; the difference is the deleted v1 tests). `tsc`
  clean, `lint` 0 errors, `next build` passes.
- Playwright: the Phase 9 walkthrough still passes (30/30). A smoke test
  (18/18) shows the Admin home with only the v2 buttons, the same for the
  Requester, Scheduler and Driver homes, `/api/bookings` and `/api/records`
  returning 404, bootstrap without `bookings` or `records`, and a vehicle
  rename through the API moving the plate onto schedule versions, keeping
  the Driver, and refusing an existing plate with 409. Each remaining Admin
  screen opens.

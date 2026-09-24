# KOVA v2.0 — Phase 9: Admin finished trips and printing

Branch `feat/v2-finished-trips`, stacked on `feat/v2-cancellation`
(Phase 8 is already merged into it). The tables, RLS and Done lock exist
(migration 0017) and the Driver RPCs exist (0029); this phase adds the
Admin RPCs, API routes and screens, and replaces the v1 Finished Trips
screens. Local Docker database only.

**Status: built; browser walkthrough passed (31 checks).** The decisions
below were approved before the migrations were written.

## 1. Scope

| Action | Who | Result |
|---|---|---|
| `correct_completion` | Admin | Changes the odometer pair of a `SUBMITTED` completion. Refused once `DONE`. |
| `mark_completion_done` | Admin | `SUBMITTED` → `DONE`, with `done_at` and `done_by_account_id`. The existing trigger then locks the record for everyone. |
| `handle_problem` | Admin | `OPEN` → `HANDLED` with a handling note, `handled_at` and `handled_by_account_id`. |

- **Corrections and Done apply to the whole schedule's single odometer
  pair**, as in Phase 8. Nothing per leg.
- **A `DONE` completion cannot change**, including through the service
  role (trigger already in place). The RPCs refuse it with a clear
  message before the trigger would.
- **Problem reports** stay separate from completion: a trip can be
  `DONE` with an `OPEN` report, and vice versa.
- Every RPC locks the schedule row first (same lock order as Phases 3–8)
  and writes an `audit_events` row.

## 2. Screens and routes

- **Admin Finished Trips** (replaces `admin-finished-trips.tsx` and
  `review-trip.tsx`): list of v2 completions with filters (date, Driver,
  vehicle, status Submitted/Done, problems Open/None), and a detail view
  with the approved route, the odometer pair, correction, **Mark as
  done**, and the schedule's problem reports with **Mark handled**.
- **Driver Finished Trips** (replaces the v1 part of `driver-trips.tsx`):
  read-only list of the Driver's own submitted and Done trips, with any
  problem reports they filed and their handled status.
- **Printing:** a print view of one finished trip, reusing the existing
  `@media print` A4 approach in `app/globals.css` (chrome hidden, only
  the form rendered), fed from v2 schedule data instead of the v1 record.
- Routes: `PATCH /api/schedules/:id/completion` (correct),
  `POST /api/schedules/:id/completion/done`,
  `POST /api/problems/:id/handle`. Bootstrap already returned
  completions and problems; the mappers now include the Done and
  handling fields.

## 3. Decisions

1. **Follow-up schedule link: added.** Migration 0030 adds nullable
   `problem_reports.follow_up_schedule_id`. Only a `HANDLED` report can
   carry it, and `handle_problem` requires it to be a different, active
   schedule.
2. **Only an Admin corrects, marks Done or handles.** Schedulers can read
   problem reports (Phase 3 RLS) but not act on them.
3. **Print contents:** header and logo, Driver, plate, both odometers,
   distance, the eight-row route table from the approved version (planned
   times), problem notes with how they were handled, and the PM/COO
   approval block. The v1 return-condition checkboxes and Finance block
   are dropped: v2 stores nothing for them.
4. **Done is always a manual Admin action**, never automatic.
5. **Cancellation after Done:** unchanged; Phase 7/8 guards already block it.
6. **Repeating is safe:** marking Done or handling again returns the
   existing row instead of an error.

## 4. Not in this phase

- Migrating v1 records into v2 completions: Phase 10 rehearsal.
- Requester-facing progress changes (`request_progress` already derives
  from schedule state).
- Applying migrations to `kc-kova`; release is Phase 11.

## 5. Verification plan

Planned: pgTAP for the three RPCs (role limits, `SUBMITTED`-only corrections,
Done locking, handling fields, audit rows, follow-up validation if kept),
vitest for mappers and body parsing, API smoke as Admin and Driver, and a
browser walkthrough covering correction, Done, handling a problem, and
the print view.

## 6. Results

- Migrations `0030_v2_problem_follow_up.sql` and
  `0031_v2_finished_trip_rpcs.sql`. pgTAP **35/35** for
  `v2_finished_trips.test.sql`; all five files (214 tests) pass on a
  fresh local reset. Covers role limits, unknown ids, odometer validation,
  correcting only while `SUBMITTED`, Done and its lock (including direct
  writes), repeat calls, follow-up validation (same, unknown and cancelled
  schedules), and audit history.
- vitest **121/121** (was 111): Done and handling mappers, handle-problem
  body parsing, and the finished-trip builder. `tsc` clean, `lint` 0
  errors, `next build` passes.
- Browser walkthrough (Playwright, Chromium, 31 checks): Dan submits and
  reports; the Admin filters the list, corrects odometers (validation and
  the updated distance), handles the problem with a follow-up (the list
  offers only the other schedule), checks the print view under print media
  (form shown, shell and dialog hidden, contents present), and marks it
  Done (buttons disabled, the API refuses a later correction with 422);
  Dan then sees it Done with the handled note, and Dee sees nothing. It
  found the route table and footer buttons overflowing the default dialog
  width, fixed by widening both finished-trip dialogs.
- **Not done:** no concurrency.sh race for Done against a correction, and
  a real paper print hasn't been checked (only print-media emulation).
- **Left for cleanup:** the v1 record editor in `scheduler.tsx`
  (`reviewRecordId` and `driverBooking` props, `PrintForm`) is no longer
  reachable from any screen, and `getDriverTrips` in `kova-api.ts` is
  unused. No phase is assigned to remove the v1 screens and code yet.
- **Local database only.** 0030 and 0031 are not applied to `kc-kova`.

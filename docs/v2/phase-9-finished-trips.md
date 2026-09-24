# KOVA v2.0 — Phase 9: Admin finished trips and printing

Branch `feat/v2-finished-trips`, stacked on `feat/v2-cancellation`
(Phase 8 is already merged into it). The tables, RLS and Done lock exist
(migration 0017) and the Driver RPCs exist (0029); this phase adds the
Admin RPCs, API routes and screens, and replaces the v1 Finished Trips
screens. Local Docker database only.

**Status: scope draft.** Items under "Open questions" need a decision
before the migration is written.

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
  `POST /api/problems/:id/handle`. Bootstrap already returns
  completions and problems; it will also return handling fields.

## 3. Open questions

1. **Follow-up schedule link.** Phase 8 noted `problem_reports` has no
   follow-up column. Options: add nullable `follow_up_schedule_id`
   (migration 0030) and set it at handle time, or drop the link from v2
   and keep the handling note only. Recommendation: add the column, since
   the Phase 8 notes already promised it, and validate that the schedule
   is a different, non-cancelled one.
2. **Who may correct.** Admin only, or Scheduler too (Schedulers can
   already read problem reports)? Recommendation: Admin only.
3. **Print contents.** The v1 form has a company header, trip legs table,
   return-condition checkboxes and a PM/COO approval block. v2 has no
   return-condition data. Recommendation: keep header, route table
   (legs and stops), Driver, vehicle, odometer pair and distance,
   problem notes, and the approval block; drop return-condition
   checkboxes.
4. **Is Done manual?** Recommendation: yes, always an explicit Admin
   action, never automatic after submission.
5. **Cancellation after Done.** Already blocked by Phase 7/8 guards once
   any completion exists; no change proposed.

## 4. Not in this phase

- Migrating v1 records into v2 completions: Phase 10 rehearsal.
- Requester-facing progress changes (`request_progress` already derives
  from schedule state).
- Applying migrations to `kc-kova`; release is Phase 11.

## 5. Verification plan

pgTAP for the three RPCs (role limits, `SUBMITTED`-only corrections,
Done locking, handling fields, audit rows, follow-up validation if kept),
vitest for mappers and body parsing, API smoke as Admin and Driver, and a
browser walkthrough covering correction, Done, handling a problem, and
the print view.

# KOVA v2.0 — Phase 8: Driver completion and problem reporting

Branch `feat/v2-driver-completion`, stacked on `feat/v2-cancellation`
(Phase 7). The tables, RLS and Done lock already exist (migration 0017);
this phase adds the RPCs, API routes and Driver screens. Local Docker
database only.

## 1. Scope

| Action | Who | Result |
|---|---|---|
| `submit_completion` | The schedule's Driver | Records one odometer pair for the whole schedule, pinned to the approved version. Status `SUBMITTED`; `submitted_at` is server time. |
| `report_problem` | The schedule's Driver | Adds a short note to the approved version. No odometers, no completion. |

- **Only the approved (published) version** can be completed or reported
  on, and only by the Driver snapshotted on it.
- **Completion needs the trip to be over:** the version's last planned
  Time In (Asia/Manila) has passed. A schedule that is not `ACTIVE`, or
  already has a completion, is refused. Repeating a submit returns the
  existing completion instead of an error.
- **Odometers:** whole numbers, start ≥ 0, end ≥ start.
- **A submitted completion locks the trip** (Phase 3/7 guards already block
  revisions, approval and cancellation once one exists).
- **Problem reports** don't block anything and can be filed before or
  after the trip ends, and more than once. Note required.
- Both RPCs lock the schedule row first, so approval and completion
  serialize (Phase 3 concurrency table).

## 2. Not in this phase

- **Correcting a submitted completion** and **marking it Done** are
  Admin finished-record rules: Phase 9. The Driver cannot edit after
  submitting.
- **Handling a problem report** (`HANDLED`, Admin note) and linking a
  follow-up schedule to it: Phase 9. Phase 8 only creates `OPEN` reports.
- Admin and Scheduler see problem reports through existing RLS; no new
  screens for them here.

## 3. Screens and routes

- **Driver:** My schedule lists published schedules for the Driver
  (date, vehicle, legs and stops). Each has **Complete trip** (odometer
  start/end, confirmation) once the trip is over, and **Report a
  problem** (note).
- Routes: `POST /api/schedules/:id/completion`,
  `POST /api/schedules/:id/problems`. Bootstrap returns the Driver's
  published schedules with their completion and problems.

## 4. Verification plan

pgTAP for the RPCs, vitest for request parsing, API smoke as Driver, and
a browser walkthrough. The Phase 4 past-date Admin test is extended
through completion.

# KOVA v2.0 — Phase 7: Cancellation and request unlocking

Branch `feat/v2-cancellation`, stacked on `feat/v2-approval` (Phase 6).
One migration, `0028_v2_cancellation.sql`. Tested on the **local Docker
database only**. Nothing is ever hard-deleted: cancelled requests and
schedules keep their rows, and approved versions stay as history.

## 1. Behaviour

| Action | Who | Result |
|---|---|---|
| `cancel_request` | Owner | A request no schedule holds is cancelled at once, after a confirmation modal. |
| `request_cancellation` | Owner | A request a schedule holds gets a pending cancellation. The schedule stays in force. Optional reason. |
| `decline_cancellation` | Admin | Note required. Request and schedule stay as they were. |
| `confirm_cancellation` | Admin | Cancels only that request. Other requests on the same stop keep it. |
| `cancel_schedule` | Admin | Reason required. Frees the reservation; requests still needed go back to Not yet scheduled, unlocked. |
| Scheduler removes a request / discards a draft | Scheduler | Already worked (Phase 5); re-tested here. |

- **After a confirm, the schedule needs a new version.** The approved
  version still lists the cancelled request until the Scheduler proposes a
  version without it and the Admin approves it (the Schedules card shows
  "Route needs updating"). The planner opens that proposal with the
  cancelled request and its stops already removed. If no live request is
  left in the schedule, the schedule is cancelled instead.
- **Cancelling a schedule with a pending cancellation** cancels the request
  that asked; every other request is released. A request already
  cancelled keeps its original cancellation time.
- **A cancellation whose request is released** (its draft was discarded)
  can still be confirmed: it simply cancels the request. `cancel_request`
  on such a request also closes the pending row.
- **Not offered once the Driver has submitted the trip** (`trip_completions`
  exists): cancellation isn't a way to correct a submitted or Done trip.
- **Repeat actions are safe.** Repeating cancel, confirm, decline or
  schedule cancel returns the existing result; confirming a declined one
  (or the reverse) is refused.

## 2. Screens and routes

- **My requests:** Cancel request (unscheduled) or Request cancellation
  (scheduled), each with a confirmation modal; shows "Cancellation
  requested" and any decline note.
- **Admin Schedules:** a Cancellation requests panel (Confirm / Decline)
  above the calendar, and Cancel schedule in the Trip Record dialog.
- **Scheduler Schedules:** cards show "Cancellation requested" and "Route
  needs updating".
- Routes: `POST /api/requests/:id/cancel`, `/cancellation`;
  `POST /api/cancellations/:id/confirm`, `/decline`;
  `POST /api/schedules/:id/cancel`. Bootstrap now returns
  `cancellations` (Requester: own; Admin: all).

## 3. Verification

- pgTAP 68/68 for `v2_cancellation.test.sql` (all three files pass):
  ownership and role limits, immediate cancel, pending/decline/confirm,
  shared stop, proposal approval after a confirm, only-request schedule
  cancel, Admin schedule cancel with mixed requests, unlock and
  re-scheduling, reservation follows a draft edit, no orphan
  reservations or stranded locks, completion guard.
- `tsc` clean, `lint` 0 errors, `next build` passes, vitest 101/101.
- API smoke against the local dev server (Admin, Scheduler, Requester):
  unscheduled cancel and repeat, Scheduler 403, direct cancel of an
  included request 422, ask and repeat return the same row, decline with
  no note 422, decline, ask again, confirm and repeat, an only-request
  schedule becomes Cancelled, Admin cancel schedule (no reason 422,
  Scheduler 403) releases the request.
- **Not done:** a browser walkthrough (Playwright still isn't installed),
  and `supabase/tests/concurrency.sh` wasn't extended for the new RPCs.

## 4. Open items

- No screen for a Requester to withdraw a pending cancellation.
- Confirming does not auto-create the revised version; the Scheduler
  proposes it.
- Admin cannot cancel someone else's request directly; they cancel the
  schedule or confirm the Requester's ask.

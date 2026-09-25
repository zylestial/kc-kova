# KOVA v2.0 — Phase 6: Approval, revisions and publication

Branch `feat/v2-approval`, stacked on `feat/v2-scheduling` (Phase 5). No
migration this phase: `approve_schedule` and `return_schedule` (0021, stale
saves returning 409 since 0026) already did the work. Tested on the **local
Docker database only**.

## 1. What changed

- **Admin Schedules.** Admin Home has a **Schedules** button (the v1
  Schedule and Booking Approvals screens stay until later phases). It opens
  the same Week/Day screen the Scheduler uses. Opening a schedule that is
  Pending approval shows **Approve** and **Return**. Return asks for a
  comment ("What needs to change?"), and its button stays disabled until
  one is typed.
- **Approve** publishes the version: the previous approved version becomes
  Superseded and gives up its reservation in the same transaction. A stale
  version, an inactive Driver or vehicle, or a pending cancellation is
  refused with the RPC's message.
- **Scheduler revisions.** An approved schedule shows **Propose revision**.
  The planner opens prefilled from the approved version, headed "Propose a
  revision". The first save creates version n+1 as a draft; discarding
  before that saves nothing and leaves the approved schedule in force.
  The proposal then goes through Submit, Return and Approve like any draft.
- Routes: `POST /api/schedules/:id/approve` and `/return` (Admin only; the
  database returns 403 for any other role).

## 2. Verification

- `tsc` clean, `lint` 0 errors (2 existing `<img>` warnings), `next build`
  passes, vitest 101/101.
- API smoke against the local dev server (Admin, Scheduler, Requester):
  submit 200; approve with a stale version 409; return with no comment
  422; Scheduler and Requester calling approve/return 403; return 200 with
  the comment stored; approving a returned or already-approved schedule
  422; resubmit then approve 200; proposing a revision of an approved
  schedule 200 (v2 Draft beside v1 Approved), submit 200, approve 200 with
  v1 Superseded and exactly one reservation left.
- **Not done:** a browser walkthrough. Playwright isn't installed in the
  project, so the new Schedules dialog (Approve, Return, Propose revision)
  and planner proposal mode were type-checked and built but not clicked
  through. No new pgTAP: the lifecycle is already covered by
  `supabase/tests/v2_schedules.test.sql`.

## 3. Open items

- **Admin editing a submitted version** is supported by the RPC but has no
  screen; Admin returns it with a comment instead.
- **Admin starting a revision of an approved schedule** stays
  Scheduler-only (Phase 3's open question, decided: no change).
- **Driver's view of published schedules** and Requester progress after
  approval are Phase 8; Requester progress already derives from the
  schedule state.
- Local test accounts `p6-admin`, `p6-sched`, `p6-req` (password
  `p6test1234`) and schedule state from the smoke test were left in the
  local database.

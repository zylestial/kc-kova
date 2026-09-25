# KOVA v2.0 — Phase 5: Scheduler planning and Trip Record

Branch `feat/v2-scheduling`, stacked on `feat/v2-requests` (Phase 4).
Migrations were applied and tested on the **local Docker database only**,
as in Phases 3 and 4.

Decisions this phase is built on are in `docs/MEMORY.md`, "Phase 5 design
decisions": a schedule has at most 8 legs (the printed Daily Vehicle
Record's rows), and there is no capacity check.

## 1. What a Scheduler can now do

The Scheduler home has **Create schedule** and **Schedules**; the Phase 3
placeholder is gone.

- **Create schedule** (`app/schedule-planner.tsx`)
  1. Choose a day on a strip showing month and year; each day shows how
     many requests are still waiting.
  2. The **request pool** lists that day's unscheduled requests (and says
     how many are already in another schedule). **Existing commitments**
     lists the time other schedules already hold that day, drafts
     included.
  3. Select requests. Destinations that several selected requests share
     are grouped under **Matching destinations** for review. Nothing is
     combined automatically.
  4. Choose a vehicle; its assigned active Driver fills in (read-only). A
     vehicle with no active Driver can't be chosen. A clash with a
     commitment on the same vehicle or Driver is flagged at once.
  5. Build the Trip Record with the existing leg card and field styles.
     Leg 1 starts at ANONANG, and each origin is the previous leg's
     destination, recomputed as legs move. Each leg has destination,
     planned Time Out / Time In (never pre-filled), optional contact name
     and number, and **Requests served here**: tick each request's
     destination this leg serves. Ticking two or more makes a **shared
     stop** that keeps every requestor and purpose. A lone matching stop
     is ticked for convenience. **Add leg** and **Add final leg** sit side
     by side below the last leg. The final leg's destination is read-only
     ANONANG, and both buttons are hidden until it's removed. Legs move up
     and down with their stops, times and contact. Add leg stops at 7 so
     the final leg always fits in 8.
  6. **Save draft** reserves the time and locks the requests. **Submit for
     approval** opens a review modal with the Trip Record (Edit returns
     with everything kept). **Discard draft** asks for confirmation, then
     frees the reservation and returns the requests to Not yet scheduled.
     A list under the Trip Record says what still blocks saving or
     submitting. The server rechecks everything.
- **Schedules** (`app/schedules.tsx`): Week (default) and Day views with
  date, vehicle, Driver and status filters (Draft, Returned, Pending
  approval, Approved, Cancelled). Cards show time window, vehicle, Driver,
  requestors and route. Opening one shows its Trip Record read-only, with
  Admin's comment if it was returned. Drafts and returned schedules have
  **Edit draft**. After submit or discard, Schedules opens on the week
  just planned.
- Admin keeps the v1 Schedule and Booking Approvals screens. Reviewing,
  approving and returning v2 schedules is Phase 6.

## 2. Migrations

| # | File | What it does | Safe while v1.2 is live? |
|---|---|---|---|
| 0026 | `v2_schedule_stale_save_409` | Stale saves, submits, approvals, returns and discards raise `PT409` (HTTP 409) instead of `40001`, which PostgREST retried forever | Yes — functions only |
| 0027 | `v2_eight_leg_limit` | At most 8 legs per schedule, final leg included (was 30) | Yes — function only |

Same release-order note as Phase 4: both are numbered after the
release-time-only 0023.

## 3. API

`POST /api/schedules`, `PUT /api/schedules/:id`, `POST …/submit` and
`POST …/discard` wrap the Phase 3 RPCs. Bootstrap now returns `schedules`
(live versions only). The contract is in `BACKEND_INTEGRATION.md`,
"Schedules (v2)". `lib/schedule-input.ts` checks body shape, and
`lib/trip-record.ts` holds the editor's planning rules. Both only guide
input; every rule stays in Postgres.

## 4. Found and fixed

- **Schedule RPCs hung over HTTP on a stale save** (Phase 4 open item):
  fixed by 0026. A stale save now answers 409 in about a second.
- **Bootstrap failed with `PGRST201`** once schedules were selected:
  `schedules` and `schedule_revisions` are linked by two foreign keys
  (`schedule_id` and `published_revision_id`), so PostgREST couldn't pick
  one to embed. The select now names
  `schedule_revisions_schedule_id_fkey`.

## 5. Removed

- The Scheduler home placeholder ("Scheduling tools are not available
  yet"), replaced by the two new screens.
- Nothing else. `app/scheduler.tsx` and `app/booking-flow.tsx` still serve
  Admin's v1 Schedule and the Driver/Admin Daily Vehicle Record screens,
  which Phases 6, 8 and 9 replace.

## 6. Tests and evidence

Run on a fresh local reset (2026-09-24):

- pgTAP: **84/84** (was 83). New: a ninth leg is refused. The stale-save
  test now expects `PT409`. Shared stops, mixed purposes, request links,
  route continuity, reservation collisions and draft discard were already
  covered in Phase 3 (`v2_schedules.test.sql`).
- Concurrency: **9/9**, unchanged.
- Unit (`vitest`): **101/101** (was 73). New: schedule row mapping,
  schedule body parsing, and the Trip Record rules (origins, reordering
  with stops, add-leg/final-leg rules and the 8-leg cap, no automatic
  merge of shared stops, deselection dropping stops, save vs. submit
  problems, commitments and overlap).
- API smoke against the local dev server (per role): **29/29**. Covers
  Admin/Driver/Requester create 403, 9 legs 422, malformed body 422, draft
  with a shared stop 201, Driver following the vehicle, derived origins,
  Requester and Driver unable to see a draft, owner's edit refused once
  included, stale save **409 in ~1 s**, reordering keeping stops,
  overlapping vehicle 409, a request already scheduled 409, back-to-back
  times allowed, discard releasing the request, stale submit 409, Admin
  submit 403, submit 200, no Scheduler edit while pending, and requests
  showing Pending approval.
- Browser walkthrough (Playwright, desktop and 390 px phone): **45/45**.
  Covers everything in §1, including a stale second tab refused, a server
  overlap error shown in the planner, the Day/Week views and filters, no
  horizontal scroll on a phone, the 8-leg cap, Juan's My requests showing
  Pending approval and Not yet scheduled, and Admin having no Create
  schedule.
- App gates: `tsc` clean, `lint` 0 errors (2 existing `<img>` warnings),
  `next build` passes.

## 7. Open items

- **Admin's v2 Schedules view, approval and return** are Phase 6. Until
  then a submitted schedule stays Pending approval.
- **Scheduler proposing a revision of an approved schedule**: the RPC
  supports it, but the Schedules screen doesn't offer it yet (no approved
  schedules can exist before Phase 6). Phase 6 adds it with approval.
- **Existing commitments show v2 schedules only.** Legacy v1.2 bookings
  aren't listed and aren't checked for conflicts, as recorded in Phase 3.
  There was no legacy data to carry over, so Phase 9b dropped those tables.
- One commit subject in this phase, `e30d146` ("feat: add Scheduler menu:
  Create schedule, Schedules"), is 52 characters, over the 50-character
  limit. It was left as is rather than rewriting history.

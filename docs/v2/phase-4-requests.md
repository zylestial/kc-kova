# KOVA v2.0 — Phase 4: Requester and Admin request creation

Branch `feat/v2-requests`, stacked on `feat/v2-foundation` (Phase 3, PR
#28). Migrations were applied and tested on the **local Docker database
only**, as in Phase 3.

Decisions this phase is built on are in `docs/MEMORY.md`, "Phase 4 design
decisions".

## 1. What a Requester or Admin can now do

- **New request** (`app/request-flow.tsx`): pick a date on a strip that
  shows month and year, then enter Regular/Urgent, an optional Project /
  Site (list or Other text) and one or more destinations, each with its
  own purpose. **Review request** opens a modal; **Edit** closes it with
  every input kept; **Submit request** saves and opens My requests.
- No vehicle, Driver or time is chosen. Requested By is the signed-in
  account, shown read-only; there is no People dropdown. People settings
  and history are untouched.
- The date strip greys out days no request type allows (2–6 days ahead,
  and past days for non-Admins) and switches the type to one the chosen
  date allows. This is only a convenience: `create_request` decides.
- **My requests** (`app/my-requests.tsx`), for both roles: the caller's own
  requests with derived progress (Not yet scheduled → Scheduling → Pending
  approval → Approved → Completed → Done, or Cancelled). A request that is
  still Not yet scheduled can be edited in a modal. Once a Scheduler
  includes it in a saved draft, the modal says it can no longer be edited.
- Admin keeps the v1 Schedule and Booking Approvals screens for now. See
  `docs/MEMORY.md` for why.

## 2. Migrations

| # | File | What it does | Safe while v1.2 is live? |
|---|---|---|---|
| 0024 | `v2_keep_inactive_on_edit` | An edit may keep a destination, purpose or Project / Site the request already had, even if since made Inactive, with its original name snapshot. New choices must still be Active. | Yes — functions only |
| 0025 | `v2_request_stale_edit_409` | A stale edit fails with `PT409` (HTTP 409) instead of `40001` | Yes — function only |

**Release-order note:** both are numbered after 0023, which is
release-time only. `supabase db push` applies migrations in order, so
0024–0025 can't go out ahead of cutover without 0023 unless pushed with
`--include-all`. That's fine for the planned single cutover (Phase 11),
but it narrows the "apply 0013–0022 early" option in
`docs/v2/phase-3-schema.md` §7 to 0013–0022 only.

## 3. API

`POST /api/requests` and `PUT /api/requests/:requestId` wrap
`create_request` / `update_request`; bootstrap now returns `requests`. The
contract is in `BACKEND_INTEGRATION.md`, "Requests (v2)". Body shape is
checked by `lib/request-input.ts`; every business rule stays in Postgres.

## 4. Found and fixed: stale edits hung the API

`update_request` reported a stale `row_version` with SQLSTATE `40001`
(serialization failure). PostgREST treats `40001` as transient and retries
the transaction, and since the version check fails the same way every
time, it retried forever: the API call hung until the gateway's 60-second
timeout while Postgres kept re-running it. pgTAP and the concurrency
script call the functions directly through `psql`, so they couldn't catch
it. Fixed for requests in 0025 (`PT409`, which PostgREST maps to HTTP 409
without retrying).

**Not fixed (Phase 3 code, outside this phase):** the schedule RPCs in
0021 (`save_schedule_draft`, `submit_schedule`, `approve_schedule`,
`return_schedule`, `discard_schedule_draft`) raise `40001` the same way and
will hang the same way once Phase 5 calls them over HTTP. Tracked in
`docs/TASKS.md`.

## 5. Removed

- `app/my-bookings.tsx` — its only user was the Requester menu, now
  replaced by My requests. No other references.
- The Requester path into the v1 booking flow (`app/page.tsx`).
  `app/booking-flow.tsx` stays, because Admin's v1 Schedule screen still
  uses it until Phase 5/6.

## 6. Tests and evidence

Run on a fresh local reset (2026-09-24):

- pgTAP: **83/83** (was 72). New: an edit keeping inactive options and
  their snapshots, a newly chosen inactive option refused, and a past-date
  Admin request taken through Scheduler draft → submit → Admin approve,
  keeping its real entry time. Driver completion of that same trip is
  added in Phase 8.
- Concurrency: **9/9**, unchanged.
- Unit (`vitest`): **73/73** (was 63): request row mapping, request body
  parsing, and the date rule boundaries (6/7 days, today/tomorrow, 2–6
  refused, Admin past dates, Manila vs. UTC day).
- API smoke against the local dev server (curl, per role): create 201, 6
  days ahead 422, Urgent tomorrow 201, Requester past date 422, Admin past
  date 201, Scheduler 403, inactive destination 422, malformed body 422,
  edit 200, stale edit **409**, another Requester's request 404; bootstrap
  gives a Requester only their own requests and gives Admin and Scheduler
  all of them.
- Browser walkthrough (Playwright, desktop and 390 px phone): 22/22.
  Covers the menus per role, month and year shown, disabled days, no
  vehicle or time pickers, Requested By read-only, inactive options not
  offered, Review then Edit keeping inputs, Submit opening My requests,
  editing from My requests, a stale second tab refused, no horizontal
  scroll on a phone, and an Admin past-date request. Separately, a request
  put into a Scheduler draft shows Scheduling with no Edit button.
- App gates: `tsc` clean, `lint` 0 errors (2 existing `<img>` warnings),
  `next build` passes.

## 7. Open items

- The schedule RPCs' `40001` (§4): fix before Phase 5 wires them to HTTP.
- `scripts/seed-uat.mjs` still creates `Booker` accounts. It seeds the
  v1.2 UAT on `kc-kova`, which still uses `Booker`, so it was left alone.
  It must move to `Requester` when 0023 reaches that project.
- Cancelling a request is Phase 7. Until then a Requester can't withdraw
  an unscheduled request.

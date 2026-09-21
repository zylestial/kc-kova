# KOVA — Business Rules

This is the canonical list of rules the backend must enforce regardless of
what the frontend does or doesn't show. Any UI-side check (in
`lib/kova-api.ts`, e.g. `canManageBooking`, `canFinishTrip`,
`validateDriverSubmission`) exists only to shape the experience — it is
never a substitute for the check listed here.

## Accounts

- Only an Admin may create, edit, or reset the password of an account.
- `username` is unique across all accounts (enforced by the `accounts`
  table's `unique` constraint and, transitively, by the synthetic Auth
  email's uniqueness).
- `role` is exactly one of `Booker`, `Driver`, `Admin`.
- `status` is `Active` or `Inactive`. Accounts are never hard-deleted.
- An inactive account cannot sign in (`sign-in` and `session` both treat a
  non-Active account as "no session" and sign it out).
- Passwords are never stored or returned by KOVA's own code — Supabase Auth
  owns the credential.

## Vehicles

- Only an Admin may create or edit vehicles.
- `plate` is the primary key and must be unique.
- Renaming a plate (`PUT /api/vehicles/:plate` with a different `plate` in
  the body) must not orphan history: every booking, booking slot, and
  vehicle record referencing the old plate is moved to the new one, and the
  old plate is recorded in `vehicle_aliases` so historical lookups still
  resolve. See `rename_vehicle` in `docs/ARCHITECTURE.md`.
- A booking cannot be created against an `Inactive` vehicle
  (`block_inactive_vehicle` trigger).
- Vehicles are never hard-deleted, only marked `Inactive`.

## Bookings

- A booking may be created by a `Booker` or an `Admin`. A `Driver` may never
  create a booking (including for themselves).
- `driverId` must reference an **Active** account with role `Driver`.
- `start`/`end` are hours in `[0, 24)` / `(0, 24]` with `start < end`.
- **No overlapping active booking for the same vehicle, and none for the
  same driver, may exist for any overlapping hour on the same day.** This is
  enforced atomically by unique indexes on the `booking_slots` table (one
  row per booked hour), not by an application-level check-then-insert —
  a race between two concurrent requests must never let both succeed.
- All bookings for the same vehicle on the same date must share the same
  driver (`enforce_same_daily_driver` trigger) — a vehicle's day belongs to
  one driver, who files one Daily Vehicle Record covering every trip that
  vehicle makes that day.
- On creation, the server — never the client — sets `createdByAccountId`,
  `requestedByAccountId`, `requestedBy` (name), `createdAt`, and
  `status = SCHEDULED`, all derived from the authenticated session.
- A Booker may update or cancel a booking only if they created it
  (`createdByAccountId === session.account.id`). An Admin may update or
  cancel any booking.
- A booking that already has a **submitted** Daily Vehicle Record
  (`vehicle_records.data->>'submittedAt' is not null`) can no longer be
  edited or cancelled by anyone, Admin included — the trip is locked once
  the Driver has filed it.
- Cancelling sets `status = CANCELLED`; the row is never deleted, and its
  hour slots are freed immediately so the vehicle/driver become bookable
  again for that time.
- A cancelled booking never counts toward availability checks.

## Daily Vehicle Records

- One record row exists per `(date, plate)` — every booking for that
  vehicle on that day shares the one record, consistent with the
  one-driver-per-vehicle-per-day rule above.
- **Before submission:** only the assigned Driver of the linked booking may
  write to the record, and only while it has no `submittedAt`.
- **Submission** (`status` set to `SUBMITTED FOR REVIEW`) requires, checked
  server-side:
  - the actor is the booking's assigned driver;
  - the booking is still `SCHEDULED` and its scheduled end time has already
    passed (`canFinishTrip`);
  - start and end odometer readings are present, numeric, non-negative, and
    `end >= start`;
  - the trip's leg list is non-empty and **starts and ends at ANONANG**
    (case-insensitive), the fleet's home base.
  - On success, the server — not the client — sets `submittedAt` to the
    current time and the status to `SUBMITTED FOR REVIEW`.
- **After submission:** the Driver may no longer write to the record at
  all. Only an Admin may, and only while `status !== "DONE"`.
- **Admin edits** to a submitted record must append an immutable history
  entry (`action: "EDIT"`) recording every changed field's before/after
  value, the acting Admin's id/name, and a timestamp. History entries are
  never edited or removed once written.
- **Marking Done** (`status` set to `DONE`) is Admin-only, only legal from
  `SUBMITTED FOR REVIEW`, and appends a history entry with
  `action: "MARK AS DONE"`.
- **Once `DONE`, a record is read-only** — no further writes from anyone,
  Admin included, through the normal edit path.
- Finance fields (`submitted`, `received`, `reference`, `finance`,
  `financeDate`) and the fixed approval names (`pm`, `coo`) are Admin-only:
  a Driver's payload must never be able to set or change them, even if
  present in the request body.
- The two fixed approval names never change: Project Manager is
  **Joedel Capillan (PM)**; 2nd-level/COO approval is
  **President Vargas (COO)**.

## Booking options and people

- Only an Admin may create or edit Projects, Destinations, Purposes, or
  People.
- Inactive options remain visible on historical bookings/records but must
  not be offered when creating a *new* booking.
- Nothing in this group is ever hard-deleted.

## Cross-cutting

- **Every** permission and conflict check runs inside the backend request,
  never only in the UI. Hiding a button is not a security control.
- HTTP status conventions (see `BACKEND_INTEGRATION.md`): `401` no valid
  session, `403` role/ownership denial, `409` scheduling or uniqueness
  conflict, `422` validation failure. Successful writes return the saved
  resource as JSON, or `204` where documented (sign-out, cancel, password
  reset).
- Sign-in is rate-limited (5 failed attempts / 15 minutes per username) to
  slow down credential guessing.

# Role-Based QA Test Plan

Manual test plan for Booker, Driver, and Admin flows. Pairs UI checks with
direct API/RPC checks so a hidden button never counts as a passed
permission test. Aligns with the flows and enforcement described in
`docs/ARCHITECTURE.md` and `docs/RULES.md` — this document does not
propose changes to the app.

## Test accounts

| Username     | Role   | Notes                          |
|--------------|--------|---------------------------------|
| admin1       | Admin  | Full access                     |
| booker1      | Booker | Owns Bookings A, C              |
| booker2      | Booker | Owns Booking B                  |
| driver1      | Driver | Assigned to Bookings A, B       |
| driver2      | Driver | Assigned to Booking C           |

## Step 0: reset and bootstrap

Every account is provisioned by an Admin — there's no public sign-up (see
`README.md`). A fresh/reset database has zero accounts, so before any role
testing:

1. Reset the database (`supabase db reset --linked` against the QA
   project, or `supabase db reset --local`) — this drops all data,
   including every account.
2. Bootstrap the first Admin (`admin1`) directly with the service-role
   client, since no account yet exists to create one through the app:
   create the Auth user for `admin1@accounts.kova.internal` (Studio →
   Authentication → Add user, or `auth.admin.createUser`), then insert a
   matching `public.accounts` row with that same `id` and `role = 'Admin'`.
3. Sign in as `admin1` and use the app's Admin account management to
   create `booker1`, `booker2`, `driver1`, and `driver2` — this exercises
   the normal account-creation flow and confirms it as part of the test
   pass, rather than provisioning every account out-of-band.
4. Seed data needed before role testing, created as `admin1`/`booker1`/etc.
   through the app:
   - Vehicle(s) with distinct plates, at least one Project/Destination/
     Purpose option set in Booking Options.
   - Booking A: booker1 → driver1, future date, status SCHEDULED.
   - Booking B: booker2 → driver1, a date/time window that has already
     ended (for Driver DVR tests), status SCHEDULED.
   - Booking C: booker1 → driver2, future date, status SCHEDULED.

Login is via username, mapped internally to
`<username>@accounts.kova.internal` (`lib/supabase/accounts.ts`).

---

## 1. Booker flow

### 1.1 Sign in and view bookings/availability
1. Sign in as `booker1`.
2. Open the schedule/calendar view.

**Expected:** All bookings (not just booker1's own) are visible for
scheduling/availability purposes; vehicle/time slots already booked show as
unavailable.

- [ ] Pass/Fail

### 1.2 Create a booking (Choose Date → Vehicle & Time → Booking Details)
1. As `booker1`, start a new booking.
2. Choose Date: pick an open future date.
3. Vehicle & Time: pick a vehicle and a free hour range.
4. Booking Details: set Driver = driver1, Destination, Purpose, and
   (optionally) leave Notes blank.
5. Submit.

**Expected:**
- Booking is created with status `SCHEDULED`.
- "Requested By" on the resulting record shows booker1 automatically —
  there is no field for the user to set this themselves.
- Re-open the booking and confirm `requested_by_account_id` /
  `requested_by_name` match booker1, `created_by_account_id` matches
  booker1, matching the server-side assignment in
  `app/api/bookings/route.ts`.

- [ ] Pass/Fail — UI hides a "Requested By" input
- [ ] Pass/Fail — created record's Requested By = booker1

**API check:** `POST /api/bookings` as booker1 with a `requestedBy`/
`requestedByAccountId` field forged to booker2's id in the payload.
**Expected:** value is ignored/overwritten server-side; response still
shows booker1 as requester (values are server-assigned, not client
input, per `docs/RULES.md`).

### 1.2a Custom Destination/Purpose via "Other"
1. As `booker1`, in Booking Details open the Destination dropdown and
   choose "Other…"; type a destination not in the existing list.
2. Repeat for Purpose.
3. Submit the booking.
4. Repeat steps 1–2 from the "Edit booking" dialog (§1.3) on an existing
   scheduled booking, confirming a previously-typed custom value shows
   as an editable text field (not silently reset) when reopened.

**Expected:**
- "Choose from list" link returns the field to the dropdown and clears
  the typed value.
- Submitted booking stores the typed text verbatim in `destination`/
  `purpose` — these are free-text fields on the `bookings` row with no
  foreign key into `booking_options`, so no Admin approval step is
  required for a Booker to use a new value.
- Typing does not create or modify anything under Admin's Booking
  Options list; the typed value is scoped to that booking only.

- [ ] Pass/Fail — Other → type → submit succeeds
- [ ] Pass/Fail — "Choose from list" reverts to dropdown
- [ ] Pass/Fail — editing a booking with a pre-existing custom value shows it in the text field, not blank

**API check:** `POST /api/bookings` and `PUT /api/bookings/{id}` as
booker1 with a `destination`/`purpose` string that matches no
`booking_options` row → expect success (200/201), since
`app/api/bookings/route.ts` only requires the fields be non-empty
strings, not a match against `booking_options`.

- [ ] Pass/Fail

- [ ] Pass/Fail

### 1.3 Edit/delete own scheduled booking
1. As `booker1`, open Booking A (own, SCHEDULED).
2. Edit destination/time; save.
3. Cancel/delete a different own SCHEDULED booking.

**Expected:** Both succeed; edits persist; cancelled booking shows status
`CANCELLED` (row is not deleted, per RULES.md).

- [ ] Pass/Fail

**API check:** `PUT /api/bookings/{bookingA}` and
`DELETE /api/bookings/{bookingA}` as booker1 → both succeed (200/204),
backed by `update_booking`/`cancel_booking` RPCs.

- [ ] Pass/Fail

### 1.4 View-only on another Booker's booking
1. As `booker1`, open Booking B (owned by booker2).

**Expected:** Booking details are viewable (read-only) but no edit/delete
controls are available in the UI.

- [ ] Pass/Fail (UI)

**API check (hidden-button bypass):**
- `PUT /api/bookings/{bookingB}` as booker1 → expect 403 (RLS/`update_booking`
  rejects non-owner).
- `DELETE /api/bookings/{bookingB}` as booker1 → expect 403.

- [ ] Pass/Fail

### 1.5 Cannot change a submitted or completed trip
1. Have driver1 submit the Daily Vehicle Record for Booking B (see §2.2)
   so it moves to `SUBMITTED FOR REVIEW`.
2. As booker2 (owner), attempt to edit or cancel Booking B via UI.

**Expected:** UI no longer offers edit/cancel once a vehicle record has
been submitted for that booking.

- [ ] Pass/Fail (UI)

**API check:** `PUT /api/bookings/{bookingB}` and
`DELETE /api/bookings/{bookingB}` as booker2 → expect 403/422, since
`vehicle_records.data->>'submittedAt' is not null` locks the booking per
`docs/RULES.md`.

- [ ] Pass/Fail

### 1.6 Cancellation releases Vehicle/Driver time
1. As booker1, note the vehicle+hour slot held by a SCHEDULED booking.
2. Cancel it.
3. As booker1 (or booker2), attempt to create a new booking for the same
   vehicle/date/hour range.

**Expected:** The slot is immediately bookable again; no lingering hold on
vehicle or driver for that window.

- [ ] Pass/Fail

---

## 2. Driver flow

### 2.1 See only assigned trips
1. Sign in as `driver1`.
2. Open "My Schedule"/trip list.

**Expected:** Only Bookings A and B (assigned to driver1) appear — Booking
C (assigned to driver2) is not visible.

- [ ] Pass/Fail (UI)

**API check:** Fetch bookings list endpoint as driver1 → response
contains only driver1's bookings (RLS `bookings_select` filters on
`driver_id`, per `supabase/migrations/0007_rls_policies_per_operation.sql`).
Also attempt `GET`/`PUT` on Booking C's record as driver1 → expect 403.

- [ ] Pass/Fail

### 2.2 Finish Trip availability and DVR submission
1. As driver1, open Booking A (future/ongoing window) → confirm "Finish
   Trip" is disabled/hidden until the scheduled end time has passed.
2. Open Booking B (window already ended) → "Finish Trip" is available.
3. Fill Daily Vehicle Record: trip legs, return details, start/end
   odometer (end ≥ start), full/card/receipt checkboxes as applicable.
4. Review and submit.

**Expected:**
- Finish Trip gated by `canFinishTrip` (time-based) — cannot be forced
  early from the UI.
- Submission requires odometer end ≥ start and valid round-trip legs
  (`isAnonangRoundTrip`); invalid data is rejected with a clear error.
- After submission, status becomes `SUBMITTED FOR REVIEW`.

- [ ] Pass/Fail — Finish Trip hidden/disabled before end time
- [ ] Pass/Fail — submission validation (bad odometer, incomplete legs)
- [ ] Pass/Fail — successful submission

**API check:**
- `PUT /api/records/{bookingA}` as driver1 before the scheduled end time
  → expect rejection (booking not eligible / `canFinishTrip` false), even
  though this bypasses the disabled UI button.
- `PUT /api/records/{bookingB}` as driver1 with `endOdometer < startOdometer`
  → expect 4xx.
- `PUT /api/records/{bookingB}` as driver1 with admin-only fields (Finance,
  PM/COO, `status: DONE`) included in the payload → expect those fields
  stripped/ignored (`stripAdminOnlyFields`) rather than applied.

- [ ] Pass/Fail

### 2.3 Finished Trips is read-only and scoped
1. After submitting Booking B's record, reopen it as driver1 under
   Finished Trips.

**Expected:** Record shows read-only; no further edits possible from the
UI; no Finance section or Done control visible.

- [ ] Pass/Fail (UI)

**API check:** `PUT /api/records/{bookingB}` as driver1 again (e.g.
trying to change a leg) → expect 403, since status is no longer
`Scheduled` for driver edits.

- [ ] Pass/Fail

### 2.4 No access to other drivers' trips or Finance controls
1. As driver1, attempt to open Booking C (driver2's trip) directly by
   URL/id if the app exposes one.
2. Attempt to access any Finance-related UI.

**Expected:** Blocked/hidden in UI.

**API check:** `GET`/`PUT /api/records/{bookingC}` as driver1 → expect
403 (RLS `vehicle_records_select`/route check scoped to own `driver_id`).

- [ ] Pass/Fail

---

## 3. Admin flow

### 3.1 Settings — Accounts, Vehicles, Booking Options
1. Sign in as `admin1`.
2. Create/edit an Account (e.g. add a new Driver), reset a password.
3. Create/edit a Vehicle (add plate, rename existing per
   `0003_vehicle_rename.sql`).
4. Edit Booking Options (Projects/Destinations/Purposes/People).

**Expected:** All operations succeed and reflect immediately elsewhere in
the app (e.g. new vehicle selectable in booking flow).

- [ ] Pass/Fail

**API check (non-admin bypass):** Repeat each of the above calls
(`POST/PUT /api/accounts*`, `POST/PUT /api/vehicles*`,
`PUT /api/booking-options/**`) as booker1 and as driver1 → expect 403 on
every one (route-level Admin check + RLS `..._admin_insert/update/delete`
policies).

- [ ] Pass/Fail

### 3.2 Schedule — manage eligible bookings
1. As admin1, open Schedule and edit/cancel a booking that belongs to
   another Booker (e.g. Booking C).

**Expected:** Admin can manage bookings beyond their own, unlike a
Booker.

- [ ] Pass/Fail

### 3.3 Finished Trips — review, edit with history, Finance, PDF, Done
1. As admin1, open Booking B's submitted record under Finished Trips.
2. Edit a field (e.g. correct a leg destination) and save.
3. Confirm a history entry is recorded (action `EDIT`, before/after diff).
4. Complete Finance fields (submitted/received/reference/finance/
   financeDate).
5. Print/save the official PDF and confirm it reflects current data.
6. Mark the record as Done.

**Expected:**
- Edit succeeds and appends an immutable history entry rather than
  silently overwriting (`diffFields`).
- Finance fields save (Admin-only).
- PDF export matches the record's current values.
- Marking Done requires the record to already be `SUBMITTED FOR REVIEW`
  (attempt to mark a still-`Scheduled` or already-`DONE` record as Done
  should fail).

- [ ] Pass/Fail — edit + history entry
- [ ] Pass/Fail — Finance completion
- [ ] Pass/Fail — PDF output
- [ ] Pass/Fail — Done requires prior SUBMITTED FOR REVIEW state

### 3.4 Done records are read-only
1. After marking Booking B's record Done, attempt further edits (any
   field, including Finance) as admin1.

**Expected:** UI shows the record as locked/read-only; no save controls
work.

- [ ] Pass/Fail (UI)

**API check:** `PUT /api/records/{bookingB}` as admin1 with any field
change → expect rejection once status is `DONE` (route blocks further
writes on DONE records per `app/api/records/[recordId]/route.ts`).

- [ ] Pass/Fail

---

## 4. Cross-role tests

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 4.1 | booker2 tries to edit booker1's booking | `PUT /api/bookings/{bookingA}` as booker2 | 403 |
| 4.2 | driver2 tries to submit driver1's DVR | `PUT /api/records/{bookingA or B}` as driver2 | 403 (driver_id mismatch) |
| 4.3 | driver1 tries to cancel a booking | `DELETE /api/bookings/{bookingA}` as driver1 | 403 (Drivers cannot manage bookings) |
| 4.4 | booker1 tries Driver DVR submission on own booking | `PUT /api/records/{bookingA}` as booker1 | 403 (not the assigned driver) |
| 4.5 | booker1 tries Admin-only endpoints | any `/api/accounts*`, `/api/vehicles*`, `/api/booking-options/**`, Finance/Done fields on `/api/records/*` as booker1 | 403 across the board |
| 4.6 | driver1 tries Admin-only endpoints | same set as driver1 | 403 across the board |
| 4.7 | Two Bookers double-book same vehicle/slot | booker1 and booker2 submit `POST /api/bookings` for the same plate/date/overlapping hours concurrently | Second request fails with 409 (unique constraint conflict) rather than double-booking |
| 4.8 | Forged `role` or account id in request body | Any of the above write requests with a spoofed `role: "Admin"` or `accountId` in the JSON payload | Server ignores client-supplied identity; authorization derives from the authenticated session only |

- [ ] 4.1 Pass/Fail
- [ ] 4.2 Pass/Fail
- [ ] 4.3 Pass/Fail
- [ ] 4.4 Pass/Fail
- [ ] 4.5 Pass/Fail
- [ ] 4.6 Pass/Fail
- [ ] 4.7 Pass/Fail
- [ ] 4.8 Pass/Fail

---

## 5. Error / edge cases

- [ ] Sign-in lockout: 5 failed logins for one username within 15 minutes
  blocks further attempts (`login_attempts` table, `docs/RULES.md`).
- [ ] Booking with missing required field (Driver/Destination/Purpose)
  rejected client-side and server-side (`app/api/bookings/route.ts`
  validation → 422).
- [ ] Double-submitting the same DVR (retry after success) does not
  create duplicate history entries or change status unexpectedly.
- [ ] Attempting to book a past date/time slot is rejected (per existing
  "grey out past slots" behavior).
- [ ] Vehicle rename does not orphan existing bookings referencing the
  old plate (`0003_vehicle_rename.sql`).

---

## Pass/Fail summary checklist

- [ ] 1. Booker flow (incl. 1.2a Other Destination/Purpose) — all subsections pass
- [ ] 2. Driver flow — all subsections pass
- [ ] 3. Admin flow — all subsections pass
- [ ] 4. Cross-role tests — all pass
- [ ] 5. Error/edge cases — all pass

Any failing item should be filed with: role/account used, exact
request/response (or screenshot), and the expected behavior per the
architecture/rules doc it violates.

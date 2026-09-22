# Role-Based QA Test Plan

Manual test plan for Admin, Booker, and Driver flows. Pairs UI checks with
direct API/RPC checks so a hidden button never counts as a passed
permission test. Aligns with the flows and enforcement described in
`docs/ARCHITECTURE.md` and `docs/RULES.md` — this document does not
propose changes to the app.

**Structure:** organized as one continuous session per account, in the
order below, so you sign in once per account and run every check for that
account before switching. Two accounts (`booker2`, `admin1`) are
genuinely revisited later, because a later account's action (driver1
submitting a DVR) changes what the earlier account can test — those spots
are called out explicitly as **Prerequisite** notes rather than being
interleaved. Section 4 (Cross-role tests) is API-only by design: reuse
each account's session/token from its earlier sign-in instead of doing
fresh UI logins.

## Test accounts

| Username     | Role   | Notes                          |
|--------------|--------|---------------------------------|
| admin1       | Admin  | Full access                     |
| booker1      | Booker | Owns Bookings A, C              |
| booker2      | Booker | Owns Booking B                  |
| driver1      | Driver | Assigned to Bookings A, B       |
| driver2      | Driver | Assigned to Booking C           |

## Session order

1. admin1 — setup (§1)
2. booker1 (§2)
3. booker2 (§3)
4. driver1 (§4)
5. booker2 — revisit, prerequisite: driver1's DVR submission in §4 (§5)
6. driver2 (§6)
7. admin1 — revisit, prerequisite: driver1's DVR submission in §4 (§7)
8. Cross-role tests — API-only, no fresh UI logins (§8)
9. Error/edge cases (§9)

---

## 1. Session: admin1 — setup

### 1.0 Bootstrap
Every account is provisioned by an Admin — there's no public sign-up (see
`README.md`). If `admin1` doesn't already exist, bootstrap it directly
with the service-role client, since no account yet exists to create one
through the app: create the Auth user for
`admin1@accounts.kova.internal` (Studio → Authentication → Add user, or
`auth.admin.createUser`), then insert a matching `public.accounts` row
with that same `id` and `role = 'Admin'`.

Login is via username, mapped internally to
`<username>@accounts.kova.internal` (`lib/supabase/accounts.ts`).

- [ ] Pass/Fail — bootstrap

### 1.1 Sign in and create the other four accounts
1. Sign in as `admin1`.
2. Use the app's Admin account management to create `booker1`, `booker2`,
   `driver1`, and `driver2` — this exercises the normal account-creation
   flow and confirms it as part of the test pass, rather than provisioning
   every account out-of-band.
3. Reset a password for one of them.

**Expected:** All four accounts are created and immediately usable to
sign in.

- [ ] Pass/Fail

### 1.2 Vehicles and Booking Options
1. Create Vehicle(s) with distinct plates.
2. Rename an existing vehicle (per `0003_vehicle_rename.sql`).
3. Create at least one Project/Destination/Purpose option set in Booking
   Options.

**Expected:** All operations succeed and reflect immediately elsewhere in
the app (e.g. new vehicle selectable in booking flow).

- [ ] Pass/Fail

**API check (non-admin bypass) — do this now while admin1 is signed in,
using booker1's and driver1's credentials/tokens rather than switching the
UI session:** Repeat each of the above calls (`POST/PUT /api/accounts*`,
`POST/PUT /api/vehicles*`, `PUT /api/booking-options/**`) as booker1 and
as driver1 → expect 403 on every one (route-level Admin check + RLS
`..._admin_insert/update/delete` policies).

- [ ] Pass/Fail

Sign out of admin1. This is the only time you leave the admin1 session
until §7.

---

## 2. Session: booker1

### 2.1 Sign in and view bookings/availability
1. Sign in as `booker1`.
2. Open the schedule/calendar view.

**Expected:** All bookings (not just booker1's own) are visible for
scheduling/availability purposes; vehicle/time slots already booked show
as unavailable.

- [ ] Pass/Fail

### 2.2 Create Booking A (Choose Date → Vehicle & Time → Booking Details)
1. Start a new booking.
2. Choose Date: pick an open future date.
3. Vehicle & Time: pick a vehicle and a free hour range.
4. Booking Details: set Driver = driver1, Destination, Purpose, and
   (optionally) leave Notes blank.
5. Submit. This is **Booking A** (booker1 → driver1, future, SCHEDULED).

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

- [ ] Pass/Fail

### 2.2a Custom Destination/Purpose via "Other"
1. In Booking Details open the Destination dropdown and choose "Other…";
   type a destination not in the existing list.
2. Repeat for Purpose.
3. Submit the booking. This is **Booking C** (booker1 → driver2, future,
   SCHEDULED).
4. Repeat steps 1–2 from the "Edit booking" dialog (§2.3) on Booking C,
   confirming the previously-typed custom value shows as an editable text
   field (not silently reset) when reopened.

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

### 2.3 Edit/delete own scheduled booking
1. Open Booking A (own, SCHEDULED).
2. Edit destination/time; save.
3. Create a throwaway third booking and cancel/delete it (keep A and C
   intact — they're reused later).

**Expected:** Both succeed; edits persist; cancelled booking shows status
`CANCELLED` (row is not deleted, per RULES.md).

- [ ] Pass/Fail

**API check:** `PUT /api/bookings/{bookingA}` and
`DELETE /api/bookings/{throwaway}` as booker1 → both succeed (200/204),
backed by `update_booking`/`cancel_booking` RPCs.

- [ ] Pass/Fail

### 2.6 Cancellation releases Vehicle/Driver time
1. Note the vehicle+hour slot held by the throwaway booking cancelled in
   §2.3.
2. Attempt to create a new booking for the same vehicle/date/hour range.

**Expected:** The slot is immediately bookable again; no lingering hold on
vehicle or driver for that window.

- [ ] Pass/Fail

Sign out of booker1.

---

## 3. Session: booker2

### 3.1 Create Booking B
1. Sign in as `booker2`.
2. Start a new booking: Driver = driver1, a date/time window that has
   already ended (needed for the Driver DVR tests in §4). Submit. This is
   **Booking B** (booker2 → driver1, ended window, SCHEDULED).

**Expected:** Booking is created with status `SCHEDULED`, Requested By =
booker2.

- [ ] Pass/Fail

### 3.2 View-only on another Booker's booking
1. Open Booking A or Booking C (both owned by booker1, created in §2).

**Expected:** Booking details are viewable (read-only) but no edit/delete
controls are available in the UI.

- [ ] Pass/Fail (UI)

**API check (hidden-button bypass):**
- `PUT /api/bookings/{bookingA}` as booker2 → expect 403 (RLS/
  `update_booking` rejects non-owner).
- `DELETE /api/bookings/{bookingA}` as booker2 → expect 403.

- [ ] Pass/Fail

Sign out of booker2. You'll return to it in §5, after driver1 submits
Booking B's DVR.

---

## 4. Session: driver1

### 4.1 See only assigned trips
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

### 4.2 Finish Trip availability and DVR submission
1. Open Booking A (future/ongoing window) → confirm "Finish Trip" is
   disabled/hidden until the scheduled end time has passed.
2. Open Booking B (window already ended) → "Finish Trip" is available.
3. Fill Daily Vehicle Record: trip legs, return details, start/end
   odometer (end ≥ start), full/card/receipt checkboxes as applicable.
4. Review and submit. Booking B's record moves to `SUBMITTED FOR REVIEW`.

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

### 4.3 Finished Trips is read-only and scoped
1. Reopen Booking B's record under Finished Trips.

**Expected:** Record shows read-only; no further edits possible from the
UI; no Finance section or Done control visible.

- [ ] Pass/Fail (UI)

**API check:** `PUT /api/records/{bookingB}` as driver1 again (e.g.
trying to change a leg) → expect 403, since status is no longer
`Scheduled` for driver edits.

- [ ] Pass/Fail

### 4.4 No access to other drivers' trips or Finance controls
1. Attempt to open Booking C (driver2's trip) directly by URL/id if the
   app exposes one.
2. Attempt to access any Finance-related UI.

**Expected:** Blocked/hidden in UI.

**API check:** `GET`/`PUT /api/records/{bookingC}` as driver1 → expect
403 (RLS `vehicle_records_select`/route check scoped to own `driver_id`).

- [ ] Pass/Fail

Sign out of driver1.

---

## 5. Session: booker2 (revisit)

**Prerequisite:** §4.2 (driver1 submits Booking B's DVR) must be complete
— this section tests that a submitted trip locks the booking.

### 5.1 Cannot change a submitted or completed trip
1. Sign in as `booker2`.
2. Attempt to edit or cancel Booking B via UI.

**Expected:** UI no longer offers edit/cancel once a vehicle record has
been submitted for that booking.

- [ ] Pass/Fail (UI)

**API check:** `PUT /api/bookings/{bookingB}` and
`DELETE /api/bookings/{bookingB}` as booker2 → expect 403/422, since
`vehicle_records.data->>'submittedAt' is not null` locks the booking per
`docs/RULES.md`.

- [ ] Pass/Fail

Sign out of booker2.

---

## 6. Session: driver2

### 6.1 Sees only Booking C
1. Sign in as `driver2`.
2. Open "My Schedule"/trip list.

**Expected:** Only Booking C appears; Bookings A and B are not visible.

- [ ] Pass/Fail (UI)

**API check:** `GET`/`PUT` on Booking A or B's record as driver2 →
expect 403.

- [ ] Pass/Fail

Sign out of driver2.

---

## 7. Session: admin1 (revisit)

**Prerequisite:** §4.2 (driver1 submits Booking B's DVR) must be complete
— this section reviews and closes out that submitted record, and manages
a booking (C) that wasn't visible to admin1 until §2 created it.

### 7.1 Schedule — manage eligible bookings
1. Sign in as `admin1`.
2. Open Schedule and edit/cancel Booking C (belongs to booker1).

**Expected:** Admin can manage bookings beyond their own, unlike a
Booker.

- [ ] Pass/Fail

### 7.2 Finished Trips — review, edit with history, Finance, PDF, Done
1. Open Booking B's submitted record under Finished Trips.
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

### 7.3 Done records are read-only
1. After marking Booking B's record Done, attempt further edits (any
   field, including Finance).

**Expected:** UI shows the record as locked/read-only; no save controls
work.

- [ ] Pass/Fail (UI)

**API check:** `PUT /api/records/{bookingB}` as admin1 with any field
change → expect rejection once status is `DONE` (route blocks further
writes on DONE records per `app/api/records/[recordId]/route.ts`).

- [ ] Pass/Fail

Sign out of admin1.

---

## 8. Cross-role tests (API-only)

These are all authorization checks, not UI flows — run them with each
account's saved session/token from its earlier sign-in (§1–§7) rather
than doing fresh UI logins.

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 8.1 | booker2 tries to edit booker1's booking | `PUT /api/bookings/{bookingA}` as booker2 | 403 |
| 8.2 | driver2 tries to submit driver1's DVR | `PUT /api/records/{bookingA or B}` as driver2 | 403 (driver_id mismatch) |
| 8.3 | driver1 tries to cancel a booking | `DELETE /api/bookings/{bookingA}` as driver1 | 403 (Drivers cannot manage bookings) |
| 8.4 | booker1 tries Driver DVR submission on own booking | `PUT /api/records/{bookingA}` as booker1 | 403 (not the assigned driver) |
| 8.5 | booker1 tries Admin-only endpoints | any `/api/accounts*`, `/api/vehicles*`, `/api/booking-options/**`, Finance/Done fields on `/api/records/*` as booker1 | 403 across the board |
| 8.6 | driver1 tries Admin-only endpoints | same set as driver1 | 403 across the board |
| 8.7 | Two Bookers double-book same vehicle/slot | booker1 and booker2 submit `POST /api/bookings` for the same plate/date/overlapping hours concurrently | Second request fails with 409 (unique constraint conflict) rather than double-booking |
| 8.8 | Forged `role` or account id in request body | Any of the above write requests with a spoofed `role: "Admin"` or `accountId` in the JSON payload | Server ignores client-supplied identity; authorization derives from the authenticated session only |

- [ ] 8.1 Pass/Fail
- [ ] 8.2 Pass/Fail
- [ ] 8.3 Pass/Fail
- [ ] 8.4 Pass/Fail
- [ ] 8.5 Pass/Fail
- [ ] 8.6 Pass/Fail
- [ ] 8.7 Pass/Fail
- [ ] 8.8 Pass/Fail

---

## 9. Error / edge cases

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

- [ ] 1. admin1 setup — all subsections pass
- [ ] 2. booker1 — all subsections pass
- [ ] 3. booker2 — all subsections pass
- [ ] 4. driver1 — all subsections pass
- [ ] 5. booker2 revisit — pass
- [ ] 6. driver2 — all subsections pass
- [ ] 7. admin1 revisit — all subsections pass
- [ ] 8. Cross-role tests — all pass
- [ ] 9. Error/edge cases — all pass

Any failing item should be filed with: role/account used, exact
request/response (or screenshot), and the expected behavior per the
architecture/rules doc it violates.

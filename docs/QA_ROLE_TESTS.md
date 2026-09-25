# Role-Based QA Test Plan

Manual test plan for Admin, Requester, and Driver flows, covering v1.1's
Booking Type + universal Admin approval flow: every new booking is created
`PENDING` (holds no slot) until an Admin approves it (→ `SCHEDULED`,
reserving the slot) or denies it (→ `REJECTED`). Run as one continuous
session per account, in the order below, so you sign in once per account
and do everything for that account before switching. Two accounts
(`requester2`, `admin1`) are revisited later because a later account's action
changes what the earlier account can test — those spots are called out as
**Prerequisite** notes.

## Test accounts

| Username | Role   | Notes                     |
|----------|--------|----------------------------|
| admin1   | Admin  | Full access                |
| requester1  | Requester | Owns Bookings A, C         |
| requester2  | Requester | Owns Booking B             |
| driver1  | Driver | Assigned to Bookings A, B  |
| driver2  | Driver | Assigned to Booking C      |

## Session order

1. admin1 — setup (§1)
2. requester1 (§2)
3. requester2 (§3)
4. admin1 — approve Bookings A, B, C (§4)
5. driver1 (§5), prerequisite: §4
6. requester2 — revisit, prerequisite: driver1's DVR submission in §5 (§6)
7. driver2 (§7), prerequisite: §4
8. admin1 — revisit, prerequisite: driver1's DVR submission in §5 (§8)
9. Final basic checks (§9)

---

## 1. Session: admin1 — setup

1. Sign in as `admin1`.
2. Create `requester1`, `requester2`, `driver1`, and `driver2` through the
   normal Admin account-management flow.
3. Reset a password for one of them.
4. Add a vehicle.
5. Rename an existing vehicle.
6. Add at least one Project/Destination/Purpose option in Booking Options.
7. Confirm the new vehicle/options appear when starting a booking.

**Expected:** every create/update succeeds and is immediately usable
elsewhere in the app.

- [ ] Pass/Fail

Sign out of admin1.

---

## 2. Session: requester1

1. Sign in as `requester1`.
2. Open the schedule and confirm existing bookings and unavailable times
   are visible — a `PENDING` booking never blocks a slot, only `SCHEDULED`
   ones do.
3. Create **Booking A**: pick a future date/vehicle/time, assign
   `driver1`, set a Destination/Purpose, and choose **Booking Type:
   Regular** (needs a date at least 7 days out — you'll see a warning and
   Confirm stays disabled if the date is too soon). Submit.
4. Confirm the result says **"Request submitted — pending approval"**,
   status **Pending**, and Requested By: requester1 — not Scheduled yet.
5. Create **Booking C**, assign `driver2`. For Destination and Purpose,
   choose "Other…" and type a custom value. Choose **Booking Type:
   Urgent** — note the Notes field is replaced by a required Urgent
   Reason field, and any date is allowed.
6. Edit Booking C and confirm the custom Destination/Purpose and Urgent
   Reason are still there.
7. Edit Booking A (still Pending) and confirm changes save.
8. Open **My Bookings** and confirm Bookings A and C both show Pending.
9. Create one throwaway booking, cancel it while Pending, then confirm
   its time slot is still open (it never held the slot).

**Expected:** all of the above succeed as described.

- [ ] Pass/Fail

Sign out of requester1.

---

## 3. Session: requester2

1. Sign in as `requester2`.
2. Create **Booking B**, assign `driver1`, using a time window that will
   have already ended by the time you reach driver1's session (§5).
   Choose either Booking Type (Regular 7+ days out, or Urgent with a
   reason).
3. Confirm it shows status **Pending**.
4. Open one of requester1's bookings (A or C).

**Expected:** Booking B is created Pending; requester1's booking is viewable
but has no edit/cancel controls.

- [ ] Pass/Fail

Sign out of requester2.

---

## 4. Session: admin1 — approve pending requests

**Prerequisite:** Bookings A, B, C all created (§2, §3).

1. Sign in as `admin1`.
2. Open **Booking Approvals** from Admin Home — confirm the count badge
   matches the number of pending requests.
3. Click into Booking A's request to see its full details (destination,
   purpose, notes or urgent reason).
4. Approve Booking A. If it conflicts with another Scheduled booking,
   confirm the dialog names how many bookings will be cancelled.
5. Approve Booking B and Booking C the same way.
6. Create one more throwaway Pending request and Deny it.

**Expected:** A, B, C all move to **Scheduled** and now correctly occupy
their vehicle/time slot; the denied throwaway becomes **Rejected** with no
effect on anything else.

- [ ] Pass/Fail

Sign out of admin1.

---

## 5. Session: driver1

**Prerequisite:** §4 (Bookings A and B approved).

1. Sign in as `driver1`.
2. Open My Schedule.
3. Confirm you see only Bookings A and B — a Pending booking never
   appears here, only Scheduled ones assigned to you.
4. Open Booking A and confirm Finish Trip is unavailable before the
   scheduled end time.
5. Open Booking B after its end time and select Finish Trip.
6. Complete the Daily Vehicle Record, including trip details and odometer
   readings.
7. Try entering an ending odometer lower than the starting odometer — the
   app should show an error.
8. Correct the information and submit.
9. Reopen the finished trip and confirm you can no longer edit it.

**Expected:** Booking B moves to Submitted for Review; everything else
matches the described behavior.

- [ ] Pass/Fail

Sign out of driver1.

---

## 6. Session: requester2 (revisit)

**Prerequisite:** §5 (driver1 submitted Booking B's DVR).

1. Sign in as `requester2`.
2. Open Booking B.

**Expected:** Booking B can no longer be edited or cancelled once a
vehicle record has been submitted for it.

- [ ] Pass/Fail

Sign out of requester2.

---

## 7. Session: driver2

**Prerequisite:** §4 (Booking C approved).

1. Sign in as `driver2`.
2. Open My Schedule.

**Expected:** only Booking C (now Scheduled) appears — Bookings A and B
are not visible.

- [ ] Pass/Fail

Sign out of driver2.

---

## 8. Session: admin1 (revisit)

**Prerequisite:** §5 (driver1 submitted Booking B's DVR).

1. Sign in as `admin1`.
2. Open Schedule and confirm Admin can manage bookings created by other
   users.
3. Open Booking B under Finished Trips, edit one detail, and save.
4. Confirm a history entry records the edit.
5. Complete the Finance information.
6. Print/save the PDF and confirm it reflects current data.
7. Mark the trip as Done.
8. Try editing it again.

**Expected:** a Done trip is locked and can no longer be changed.

- [ ] Pass/Fail

Sign out of admin1.

---

## 9. Final basic checks

- [ ] Repeated failed logins for one username eventually block further
      attempts.
- [ ] Creating a booking without a Driver, Destination, Purpose, or
      Booking Type does not submit.
- [ ] A **Regular** booking less than 7 days out is blocked with a
      warning (Confirm stays disabled).
- [ ] An **Urgent** booking with no reason entered does not submit.
- [ ] Booking a past date/time is rejected for non-Admins (unchanged from
      v1.0 — Admin retains the "log an already-elapsed slot" exemption,
      independent of Booking Type).
- [ ] As Admin, editing an already-Scheduled booking's date/time or
      vehicle/driver drops it back to **Pending**, requiring re-approval;
      editing only Notes/Destination/Purpose does not.
- [ ] Renaming a vehicle does not break older bookings using that
      vehicle — including any still-Pending ones.
- [ ] A non-owner, non-Admin Requester cannot see another Requester's Pending
      booking they have no relationship to.

Any failing item should be filed with: role/account used, exact steps,
and the expected behavior per this document or `docs/RULES.md`.

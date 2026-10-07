# KOVA — Product Requirements Document

## What KOVA is

KOVA (Kayelen's Operations and Vehicle Allocation) is an internal fleet
scheduling and trip-logging system. It replaces manual scheduling of company
vehicles and the paper "Daily Vehicle Trip & Utilization Form" with one web
app that covers: asking for transport, planning a vehicle's route for the
day, getting that plan approved, recording the trip as it happens, and
routing the finished trip through Admin review to a locked, final state.

There is no public sign-up. Every account is provisioned by an Admin.

## Roles

A person has exactly one role; there is no multi-role account.

| Role | Can do |
| --- | --- |
| **Requester** | Ask for transport (a date and one or more stops, each with a purpose). Edit or cancel their own requests until a Scheduler starts planning them; after that, ask for a cancellation. See where each request stands. |
| **Scheduler** | Plan a day: take requests from the day's pool, pick a vehicle (its assigned Driver comes with it), build the route as a Trip Record, and submit it for approval. Send back requests that won't fit, or split a request across vehicles. The only role that creates schedules. |
| **Admin** | Approve or return submitted schedules, cancel schedules, confirm or decline cancellation requests, review finished trips (correct odometers, handle problem reports, mark Done), check Drivers' attendance, and manage Accounts, Vehicles and request choices. Can also act as a Scheduler or a Driver ("View as"), attributed to the Admin. |
| **Driver** | See the approved trips assigned to them ("My Schedule"). Tap Start trip when leaving ANONANG and End trip on returning (their attendance). After a trip ends, submit its odometer readings and final-return checks. Report a problem on a trip at any time. |

## Core workflows

1. **Request a trip.** A Requester picks a date and adds each stop with its
   purpose (a destination or purpose not on the list can be typed in). The
   date decides the type: **Urgent** for today up to 6 days ahead, **Regular**
   for 7 or more days ahead. An Admin may also log a past date for a trip
   nobody requested at the time; that is recorded as Regular. No vehicle,
   Driver or time is chosen at this stage.
2. **Plan the day.** A Scheduler opens a day and sees its request pool, Urgent
   first and grouped by requester. They pick a vehicle (an Admin assigns each
   vehicle a Driver) and build the **Trip Record**: legs in travel order,
   starting and ending at ANONANG (the home base), with times for each leg.
   Fuel or errand stops can be added without a request. Saving a draft
   reserves the time and locks the requests so nobody else plans them. A
   request that won't fit can be sent back to its requester (with a reason) to
   pick another day, or split so part of it goes on another vehicle.
3. **Approve.** The Scheduler submits the plan. An Admin approves it, which
   publishes it to the Requesters and the Driver, or returns it with a
   comment saying what to change. A published schedule can be revised through
   the same steps, and an Admin can cancel it with a reason.
4. **Drive and record.** The Driver taps **Start trip** at ANONANG before
   leaving and **End trip** on returning. Each tap records the time and,
   when the phone shares it, where the Driver was; a tap away from ANONANG
   or without a location is kept but flagged. The two taps are the Driver's
   attendance for the day, and an Admin sees them on the Attendance screen.
   Once both taps are in and the trip's last planned time has passed, the
   assigned Driver submits one odometer pair for the whole schedule and may
   answer the final-return checks (full tank, fleet card used, gas receipt
   attached). A Driver can report a problem on a trip at any time, even
   before submitting.
5. **Review and close out.** An Admin reviews submitted trips in Finished
   Trips: corrects the odometers if needed, handles problem reports (a note,
   and optionally the follow-up schedule), and marks the trip **Done**, which
   locks it for everyone. Trips with no open problem can be marked Done in one
   step. The Admin can print the official form for any submitted trip.
6. **Cancel.** A Requester cancels an unplanned request directly. Once a
   schedule holds the request, they ask for a cancellation and an Admin
   confirms or declines it (a note is required to decline). Cancelling never
   deletes anything; history stays intact.
7. **Administer reference data.** An Admin maintains Accounts, Vehicles (with
   each vehicle's assigned Driver) and the request choices (Projects/Sites,
   Destinations, Purposes, and which destinations are fuel/errand stops).
   Nothing is ever hard-deleted; entries are marked Inactive so past records
   keep displaying correctly.
8. **Stay informed.** An in-app bell tells people what changed for them (a
   request scheduled, returned or sent back; a schedule waiting for approval;
   a trip published; a problem reported).

## Non-goals

- No public registration or self-service password reset — an Admin manages all
  credentials.
- No mobile app; KOVA is a responsive web app only.
- No multi-tenant support — this is a single organization's fleet.
- No email or push notifications; the bell is in-app only.

## Key constraints carried into every design decision

- **Hide-the-button is not security.** Every permission, ownership and
  conflict rule enforced in the UI must also be enforced by the backend.
- **Nothing referenced by history is ever hard-deleted** (vehicles, accounts,
  request choices) — inactive status only.
- **Conflicts must be impossible even under concurrent requests.** Two people
  planning the same request, or reserving the same vehicle or Driver for
  overlapping time, must never both succeed.
- **A Done trip is locked for everyone**, the service role included.

## Acceptance criteria

**Draft — proposed, not yet reviewed by stakeholders.** Each line is a check
a person can run in the app. The rules behind them are in `docs/RULES.md`;
"(tested)" marks the ones the browser tests in `e2e/` or the database tests
in `supabase/tests/` already check automatically.

**Requests**
- A Requester can file a request with a date and at least one stop with a
  purpose, and sees it in My requests as Not yet scheduled. (tested)
- A request 0–6 days ahead is Urgent; 7 or more days ahead is Regular. Only
  an Admin can file a past date.
- A Requester can edit or cancel their request until a Scheduler starts
  planning it, and only ask for a cancellation after that. (tested)
- A Requester never sees or changes another person's requests.

**Planning and approval**
- A Scheduler can build a schedule from a day's requests, pick a vehicle that
  has a Driver, and submit it. (tested)
- The same vehicle, Driver or request can never be booked twice for
  overlapping time, even when two people save at once. (tested)
- An Admin can approve a submitted schedule, which shows it to its
  Requesters and Driver, or return it with a comment. (tested)
- An Admin can cancel an approved schedule with a reason; its requests go
  back to Not yet scheduled and the Driver no longer sees the trip. (tested)
- An Admin can confirm or decline a cancellation request; declining needs a
  note. (tested)

**Driving and close-out**
- A Driver sees only approved trips on their own vehicle. (tested)
- A Driver can't submit a trip before its last planned Time In, and submits
  one odometer pair with the end no lower than the start. (tested)
- A Driver taps Start trip (from the trip's date) and End trip (after
  Start); both are needed before submitting. A tap more than 150 m from
  ANONANG, without a location or on a later day is flagged, not refused.
  (tested)
- An Admin sees every Driver's Start and End taps, with their flags, on the
  Attendance screen.
- A Driver can report a problem on a trip at any time.
- An Admin can correct a submitted trip's odometers and mark it Done; a Done
  trip can't be changed by anyone. (tested)
- An Admin can print the official form for any submitted trip, with the same
  fields as the paper Daily Vehicle Trip & Utilization Form.

**Accounts and access**
- Only an Admin can create accounts, set passwords, and change vehicles and
  request choices. Nothing is ever hard-deleted.
- An inactive account can't sign in. Sign-in locks after 5 wrong passwords
  in 15 minutes.
- A new password has at least 8 characters, a letter and a number, and
  doesn't contain the username. (tested)

**Still to decide:** whether the first pilot week counts as acceptance, and
who signs it off.

## Success metrics

**Draft — proposed, targets not set.** Each metric can be measured from data
KOVA already records (timestamps on requests, schedules and completions), so
no new tracking is needed. The targets in brackets need stakeholder input;
the pilot week gives the first baseline.

| Metric | How it's measured | Target |
| --- | --- | --- |
| Paper form replaced | Share of trips in a week that have a submitted completion in KOVA | [__%] |
| Requests planned in time | Share of requests in an approved schedule before their date | [__%] |
| Approval turnaround | Median time from a schedule's submit to its approval | [__ hours] |
| Trips recorded promptly | Median time from a trip's last planned Time In to the Driver's submit | [__ hours] |
| Close-out turnaround | Median time from a Driver's submit to the Admin's Done | [__ days] |
| Open problems | Problem reports still open after [__] days | [__] |
| Sent back or returned | Share of requests sent back and schedules returned, as a sign of planning friction | [__%] |

**Still to decide:** the targets, how often to review them, and whether "time
to plan a day" is worth measuring (it would need the planner to record when
planning starts).

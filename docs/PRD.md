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
| **Requester** | Ask for transport (a date and one or more stops, each with a purpose). If an Admin allows it, ask for a **Company trip** instead, picking the vehicle and its Company car Driver, and record that trip themselves on **My Trips**. Edit or cancel their own requests until a Scheduler starts planning them; after that, ask for a cancellation. See where each request stands. |
| **Scheduler** | Plan each day's Daily and Company trips on one **Scheduling** page: add waiting stops to vehicles (a Daily vehicle's assigned Driver comes with it), adjust each trip's legs and times, and submit it for approval. Send back stops that won't fit, or move an "any day that week" stop to another day. Change a trip that's waiting for the Admin, or propose changes to an approved one. The only role that creates schedules. |
| **Admin** | Approve or return submitted schedules, cancel schedules, confirm or decline cancellation requests, review finished trips (correct odometers and times, handle problem reports, mark Done, print the form), check Drivers' attendance, and manage Accounts, Vehicles and request choices, including who may request Company trips. Can also act as a Scheduler or a Driver ("View as"), attributed to the Admin. |
| **Driver** | Either a **Truck** or a **Company car** Driver. See the approved trips assigned to them ("My Schedule"). On Daily trips, tap Start trip when leaving ANONANG and End trip on returning (their attendance), and Arrived and Leaving at each stop in between; after the trip ends, submit its odometer readings and final-return checks. On Company trips the requester records the trip; the Driver only sees it. Report a problem on a trip at any time. An Admin may let a Company car Driver make requests; a Truck Driver never can. |

## Core workflows

1. **Request a trip.** A Requester picks a date and the project(s), then adds
   each stop: destination, purpose, and **Details** saying exactly what's
   needed (required for Pick up, Delivery and Urgent stops). Each stop is
   **Regular** or **Urgent**; an Urgent stop needs a reason from the Admin's
   list. Each stop also says how flexible it is: any time that day, a fixed
   time, or any day that week. Every stop becomes its own request, numbered
   under the request (52-A, 52-B), so stops can go on different vehicles or
   days. An Admin may also log a past date for a trip nobody requested at the
   time. On a **Daily** request no vehicle, Driver or time is chosen at this
   stage.
2. **Plan the day.** On the **Scheduling** page a Scheduler picks a day from
   the next two weeks, then **Daily trips** or **Company trips**. Urgent
   stops show at the top. The day's waiting stops are listed Urgent first,
   then fixed times, any time that day, and the week's "any day that week"
   stops; each vehicle is listed with its trips. A stop is added to a
   vehicle by dragging it there or by picking from the options KOVA
   suggests, best first (no other stop made late, no end after the Driver's
   6 PM end of day, then the least added time, or for an Urgent stop the
   soonest arrival). Adding an "any day that week"
   stop to another day moves it there, and its requester is told. Each
   vehicle's legs form its **Trip Record**: legs in travel order, a Daily
   trip starting and ending at ANONANG (the home base), with times for each
   leg that KOVA estimates and the Scheduler can change. Fuel or errand
   stops can be added without a request. A vehicle has one Daily trip a
   day, and a vehicle that can be requested for company trips takes only
   Company trips. Saving reserves the time and locks the requests so nobody
   else plans them. A trip with a warning (too little time to drive a leg,
   a fixed-time stop reached late, an end after 6 PM) can't be submitted
   until it's fixed. A stop that won't fit is taken off its leg and goes
   back to the waiting list, or back to its requester with a reason so they
   can pick another day. **Undo** reverses the Scheduler's last change.
3. **Approve.** The Scheduler submits the plan. An Admin approves it, which
   publishes it to the Requesters and the Driver, or returns it with a
   comment saying what to change. While a trip waits for the Admin, the
   Scheduler can still change it; that takes it back to a draft, to be
   resubmitted. A published schedule can be revised through the same steps
   (the Scheduler proposes changes; the approved times stay in effect until
   the Admin approves them), and an Admin can cancel it with a reason.
4. **Drive and record.** The Driver taps **Start trip** at ANONANG before
   leaving and **End trip** on returning. Each tap records the time and,
   when the phone shares it, where the Driver was; a tap away from ANONANG
   or without a location is kept but flagged. The two taps are the Driver's
   attendance for the day, and an Admin sees them on the Attendance screen.
   In between, the Driver taps **Arrived** at each stop and **Leaving** as
   they set off, checked against the stop's saved location the same way.
   These taps are the actual Time Out and Time In printed on the form.
   Once End trip is tapped (even before the last planned time), the
   assigned Driver submits one odometer pair for the whole schedule and may
   answer the final-return checks (full tank, fleet card used, gas receipt
   attached). A Driver can report a problem on a trip at any time, even
   before submitting.
5. **Company trips.** An account an Admin allows (with its Position set) can
   choose **Company Trip** on the request form. It adds a starting point, the
   department or site, the vehicle (one that can be requested for company
   trips), its Company car Driver, the site officer, the Immediate Supervisor
   and the PM / CM / Dept. Head, plus a supplier and contact per stop. A
   Scheduler plans these under Company trips on the Scheduling page: the
   requester's vehicle and Driver are fixed, a vehicle can take several
   trips a day as long as they don't overlap, a trip serves one department,
   and the route starts at the starting point and ends at the last stop (no
   return to ANONANG).
   Approval works as for Daily trips. The **requester** records the trip on
   My Trips: Start trip with the odometer, Arrived and Leaving at each stop,
   and End trip on reaching the last stop with the odometer again (never
   lower than the start). End trip submits it. Nothing goes into the
   Driver's Attendance.
6. **Review and close out.** An Admin reviews submitted trips in Finished
   Trips, filtered to Daily or Company trips if wanted: corrects the
   odometers if needed, fills in any Time Out or Time In nobody tapped (or
   corrects one), handles problem reports (a note, and optionally the
   follow-up schedule), and marks the trip **Done**, which locks it for
   everyone. A trip can't be Done until every time is there. Trips with no
   open problem and no missing time can be marked Done in one step. The
   Admin can print the official form for any submitted trip: the Daily
   Vehicle Trip & Utilization Form, or the **Company Trip Form** for a
   Company trip.
7. **Cancel.** A Requester cancels an unplanned request directly. Once a
   schedule holds the request, they ask for a cancellation and an Admin
   confirms or declines it (a note is required to decline). Cancelling never
   deletes anything; history stays intact.
8. **Administer reference data.** An Admin maintains Accounts (Position,
   whether the account may request Company trips, each Driver's type and
   whether a Company car Driver may make Daily or Company requests),
   Vehicles (each vehicle's assigned Driver, and whether it can be requested
   for company trips) and the request choices (Projects/Sites, Destinations,
   Purposes, which destinations are fuel/errand stops, Urgent reasons,
   Starting points, Departments / Sites, Suppliers, Immediate Supervisors and
   PM / CM / Dept. Heads). Nothing is ever hard-deleted; entries are marked
   Inactive so past records keep displaying correctly.
9. **Stay informed.** An in-app bell tells people what changed for them (a
   request scheduled, returned, sent back or moved to another day; a
   schedule waiting for approval; a trip published; a problem reported).

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
- Each stop of a request is its own numbered request (52-A, 52-B). A stop is
  Urgent only when the Requester marks it and picks a reason; Pick up,
  Delivery and Urgent stops need Details (at most 150 characters). Only an
  Admin can file a past date. (tested)
- Only an account an Admin allows, with a Position, can file a Company trip,
  and it must name a vehicle that can be requested for company trips and a
  Company car Driver. A Truck Driver can never make a request. (tested)
- A Requester can edit or cancel their request until a Scheduler starts
  planning it, and only ask for a cancellation after that. (tested)
- A Requester never sees or changes another person's requests.

**Planning and approval**
- A Scheduler can build a schedule from a day's requests, pick a vehicle that
  has a Driver, and submit it. (tested)
- The same vehicle, Driver or request can never be booked twice for
  overlapping time, even when two people save at once. (tested)
- A Scheduler can move an "any day that week" stop to another day that week,
  and its requester is told. (tested)
- A Scheduler can change a trip waiting for Admin approval; it goes back to
  a draft and must be resubmitted. (tested)
- A trip with a warning (a leg too short to drive, a fixed-time stop reached
  late, an end after 6 PM) can't be submitted.
- Daily trips on the Scheduling page don't offer vehicles that can be
  requested for company trips. A Company trip uses the requester's vehicle
  and Driver, serves one department, and never overlaps another trip on that
  vehicle. (tested)
- An Admin can approve a submitted schedule, which shows it to its
  Requesters and Driver, or return it with a comment. (tested)
- An Admin can cancel an approved schedule with a reason; its requests go
  back to Not yet scheduled and the Driver no longer sees the trip. (tested)
- An Admin can confirm or decline a cancellation request; declining needs a
  note. (tested)

**Driving and close-out**
- A Driver sees only approved trips on their own vehicle. (tested)
- A Driver can submit a trip once End trip is tapped, even before its last
  planned Time In, and submits
  one odometer pair with the end no lower than the start. (tested)
- A Driver taps Start trip (from the trip's date) and End trip (after
  Start); both are needed before submitting. A tap more than 150 m from
  ANONANG, without a location or on a later day is flagged, not refused.
  (tested)
- An Admin sees every Driver's Start and End taps, with their flags, on the
  Attendance screen.
- Between Start and End, a Driver taps Arrived and Leaving at each stop; a
  tap more than 150 m from the stop's saved location or without a location
  is flagged, not refused. (tested)
- An Admin can fill in or correct a submitted trip's Time Out / Time In, and
  can't mark it Done while one is missing. (tested)
- A Driver can report a problem on a trip at any time.
- An Admin can correct a submitted trip's odometers and mark it Done; a Done
  trip can't be changed by anyone. (tested)
- An Admin can print the official form for any submitted trip, with the same
  fields as the paper Daily Vehicle Trip & Utilization Form and the actual
  times from the taps (or the Admin's entries); a time nobody recorded
  prints blank.
- Only the requester records a Company trip, in route order, from Start trip
  to End trip at the last stop, with an ending odometer no lower than the
  start; nothing goes into Attendance. An Admin can filter Finished Trips to
  Company trips and print the Company Trip Form, with signatures and the For
  Finance Use section blank. (tested)

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

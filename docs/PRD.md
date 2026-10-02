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
| **Admin** | Approve or return submitted schedules, cancel schedules, confirm or decline cancellation requests, review finished trips (correct odometers, handle problem reports, mark Done), and manage Accounts, Vehicles and request choices. Can also act as a Scheduler or a Driver ("View as"), attributed to the Admin. |
| **Driver** | See the approved trips assigned to them ("My Schedule"). After a trip ends, submit its odometer readings and final-return checks. Report a problem on a trip at any time. |

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
4. **Drive and record.** Once the trip's last planned time has passed, the
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

TBD. The workflows above imply the natural checks (a vehicle or Driver can't
be double-booked, a trip can't be submitted before it ends, a Driver can't set
Admin-only fields, a Done trip can't change), and those are enforced and
tested in code (see `docs/RULES.md` and the database tests in
`supabase/tests/`). A formal, stakeholder-reviewed acceptance criteria list
doesn't exist yet — see `docs/MEMORY.md` "Open questions".

## Success metrics

TBD. No stakeholder input or analytics exist yet to define what KOVA's
operators consider success (for example adoption against the paper process,
time to plan a day, or Admin review turnaround). See `docs/MEMORY.md` "Open
questions".

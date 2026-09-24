# KOVA — Product Requirements Document

## What KOVA is

KOVA (Kayelen's Operations and Vehicle Allocation) is an internal fleet
booking and trip-logging system. It replaces manual scheduling of company
vehicles and paper "Daily Vehicle Record" forms with a single web app that
covers: booking a vehicle and driver, recording the trip as it happens, and
routing the completed record through Admin review to a locked, final state.

There is no public sign-up. Every account is provisioned by an Admin.

## Roles

| Role | Can do |
| --- | --- |
| **Requester** | Create/edit/cancel their own vehicle bookings. See the shared schedule. Cannot manage accounts, vehicles, booking options, or Finance data. |
| **Scheduler** | New in v2. Builds schedules (vehicle + ordered Trip Record) from Requesters' requests and submits them for Admin approval. The only role that can create a schedule. Screens arrive in v2 Phase 5. |
| **Driver** | See only their own assigned bookings ("My Schedule"). Fill in and submit the Daily Vehicle Record for a trip once it has ended. Cannot create bookings for themselves or others. |
| **Admin** | Everything a Requester can do, plus: manage Accounts, Vehicles, and Booking Options (Projects/Destinations/Purposes/People); review and edit submitted trip records; mark records Done (locking them); see Finance fields and the fixed approval names (PM, COO). |

A single person only ever has one role at a time; there is no multi-role
account.

## Core workflows

1. **Book a trip.** A Requester (or Admin) picks a date, vehicle, time range,
   driver, destination, and purpose. The system rejects the booking if the
   chosen vehicle or driver is already booked for an overlapping hour that
   day. All vehicles booked for the same vehicle on the same day must share
   one driver — one daily form covers every trip that vehicle makes that day.
2. **Drive and log.** Once a booking's scheduled end time has passed, the
   assigned Driver opens it from "My Schedule" and fills in the Daily
   Vehicle Record: start/end odometer, one or more trip legs (origin,
   destination, purpose, times, contact), and return-condition checkboxes
   (full tank, fleet card used, gas receipt attached). The trip must start
   and end at ANONANG (the home base). The Driver submits when done; the
   record locks against further Driver edits and moves to Admin review.
3. **Review and close out.** An Admin reviews submitted records, can correct
   fields (every correction is recorded as an immutable history entry with
   before/after values), fills in the fixed approval names (PM: Joedel
   Capillan; COO: President Vargas) and Finance fields (received-by,
   reference #, finance status, dates), then marks the record **Done**. Once
   Done, the record is read-only.
4. **Cancel a booking.** The Requester who created a booking, or an Admin, may
   cancel it before it has been submitted as a trip record. Cancelling never
   deletes the row — it flips status to `CANCELLED` so history and audit
   trails stay intact, and frees the vehicle/driver's time slots.
5. **Administer reference data.** An Admin maintains the roster of Accounts,
   Vehicles, and the option lists used when booking (Projects, Destinations,
   Purposes) and People (a legacy/auxiliary roster distinct from Accounts).
   Nothing is ever hard-deleted; entries are marked Inactive instead so past
   bookings and records keep displaying correctly.

## Non-goals

- No public registration or self-service password reset — Admin manages all
  credentials.
- No mobile app; KOVA is a responsive web app only.
- No multi-tenant support — this is a single organization's fleet.

## Key constraints carried into every design decision

- **Hide-the-button is not security.** Every permission, ownership, and
  conflict rule enforced in the UI must also be enforced by the backend.
- **Nothing referenced by history is ever hard-deleted** (vehicles, accounts,
  booking options) — inactive status only.
- **Booking conflicts must be impossible even under concurrent requests.**
  Two people racing to book the same vehicle/hour, or the same driver for two
  trips at once, must never both succeed.

## Acceptance criteria

TBD. The core workflows above imply the natural acceptance checks (a
booking can't be double-booked, a record can't be submitted before the
trip's scheduled end, Finance fields can't be set by a Driver, etc.), and
those are enforced and tested in code (see `docs/RULES.md`,
`docs/TASKS.md`). A formal, stakeholder-reviewed acceptance criteria list
doesn't exist yet — see `docs/MEMORY.md` "Open questions".

## Success metrics

TBD. No stakeholder input or analytics exist yet to define what KOVA's
actual operators consider success (e.g. adoption vs. the paper process it
replaces, time-to-log a trip, Admin review turnaround). See
`docs/MEMORY.md` "Open questions".

# KOVA backend integration

The frontend sends JSON requests through `lib/kova-api.ts`. Set `NEXT_PUBLIC_KOVA_API_BASE_URL` when the API is on another origin. All requests use `credentials: "include"`, so the recommended authentication model is a secure HttpOnly session cookie.

## Authentication

| Method | Endpoint | Request | Response |
| --- | --- | --- | --- |
| POST | `/api/auth/sign-in` | `{ username, password }` | `{ account }` and a secure session cookie |
| GET | `/api/auth/session` | — | `{ account: Account \| null }` |
| POST | `/api/auth/sign-out` | — | `204` and invalidate the session |

Recommended cookie attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, and a short idle expiry. Rate-limit sign-in attempts. Store only a strong password hash such as Argon2id or bcrypt.

## Initial application data

`GET /api/bootstrap` returns the data the signed-in role may access:

```json
{
  "accounts": [],
  "vehicles": [],
  "options": {
    "projects": [],
    "destinations": [],
    "purposes": []
  },
  "people": [],
  "requests": [],
  "schedules": [],
  "cancellations": [],
  "completions": [],
  "problems": []
}
```

`requests` holds v2 transport requests (see "Requests (v2)" below), each with its active destinations in travel order and its derived `progress`. A Requester receives only their own; Scheduler and Admin receive all.

`schedules` holds v2 schedules (see "Schedules (v2)" below) with their live versions only: the published one and any open draft. Discarded schedules and superseded versions are left out. Scheduler and Admin receive all, drafts included; Requesters and Drivers receive only published versions that concern them.

`cancellations`, `completions` and `problems` hold cancellation asks, trip completions and problem reports. Requesters get their own cancellation asks and Admin gets all; a Driver gets only their own completions and problem reports, and Admin gets all.

Never include password hashes or session tokens. A Driver should receive only their own assigned schedules, completions and problem reports.

## Accounts and Vehicles

| Method | Endpoint | Permission |
| --- | --- | --- |
| POST | `/api/accounts` | Admin |
| PUT | `/api/accounts/:accountId` | Admin |
| POST | `/api/accounts/:accountId/password` | Admin |
| POST | `/api/vehicles` | Admin |
| PUT | `/api/vehicles/:plate` | Admin |

Account usernames and Vehicle plate numbers must be unique. Use `Active` and `Inactive`; do not hard-delete rows referenced by history.

## Requests (v2)

| Method | Endpoint | Permission |
| --- | --- | --- |
| POST | `/api/requests` | Requester or Admin |
| PUT | `/api/requests/:requestId` | Owner only (Requester or Admin), while not yet scheduled |

Body (`RequestInput` in `lib/kova-api.ts`): `date`, `requestType` (`REGULAR` \| `URGENT`), optional `projectId` or `projectOther` (not both), and `destinations` — one or more `{ destinationId, purposeId }` in travel order. `PUT` also sends `rowVersion`, the version the form was opened on. There is no vehicle, Driver or time. Requested By is always the signed-in account.

The database enforces the rules (`create_request` / `update_request`): Regular at least 7 Manila calendar days ahead, Urgent today or tomorrow, 2–6 days ahead refused, Admin may also pick a past date. New choices must be Active options; an edit may keep options the request already had. Responses: `403` wrong role, `404` not the owner, `409` the request changed since the form was opened, `422` anything else (date rule, inactive option, already being scheduled) with a message to show.

## Schedules (v2)

| Method | Endpoint | Permission |
| --- | --- | --- |
| POST | `/api/schedules` | Scheduler only (creates the schedule as a first draft) |
| PUT | `/api/schedules/:scheduleId` | Scheduler on a DRAFT/RETURNED version; Admin on a SUBMITTED version (Phase 6) |
| POST | `/api/schedules/:scheduleId/submit` | Scheduler |
| POST | `/api/schedules/:scheduleId/discard` | Scheduler, unsubmitted drafts only |

Body (`ScheduleInput` in `lib/kova-api.ts`): `date`, `plate`, `requestIds`, and `legs` in travel order. Each leg is `{ destinationId, plannedTimeOut, plannedTimeIn, contactName, contactNumber, stops, isFinal }`, where `stops` are the request destination ids served at that leg (two or more is a shared stop) and times are `HH:MM`. The final leg sends `isFinal: true` and no destination. Origins are never sent; the server derives them from ANONANG and each previous destination. `PUT`, `submit` and `discard` also send `rowVersion`, the version the editor was opened on. The Driver always follows the vehicle's assignment.

The database enforces the rules (`save_schedule_draft`, `submit_schedule`, `discard_schedule_draft`): at most 8 legs including the final leg, route continuity, times in order, stops belonging to included requests at the leg's destination, a vehicle with an active Driver, one schedule per request, and no overlapping vehicle or Driver time. Submitting also requires the final leg and every destination of every included request on a leg. Saving a draft reserves the time and locks its requests; discarding frees both. Responses return the schedule. Errors: `403` wrong role, `404` unknown schedule, `409` stale `rowVersion` or a lost race for a request or time slot, `422` anything else, with a message to show.

## Trip completions and problem reports (v2)

| Method | Endpoint | Permission |
| --- | --- | --- |
| POST | `/api/schedules/:scheduleId/completion` | Assigned Driver, after the trip ends |
| PATCH | `/api/schedules/:scheduleId/completion` | Admin, until the trip is Done |
| POST | `/api/schedules/:scheduleId/completion/done` | Admin |
| POST | `/api/schedules/:scheduleId/problems` | Assigned Driver |
| POST | `/api/problems/:problemId/handle` | Admin (handling note required, optional `followUpScheduleId`) |

A completion is one odometer pair (`startOdometer`, `endOdometer`) for the whole schedule, pinned to the approved version. The server sets `submittedAt`; a Done completion is locked for everyone. Repeating a submit or Done returns the existing row. Errors follow the schedule routes: `403` wrong role, `404` unknown schedule or problem, `422` anything else, with a message to show.

The printed form's approval names are fixed:

- Project Manager: Joedel Capillan (PM)
- 2nd-Level Approval / COO: President Vargas (COO)

## Booking options

| Method | Endpoint | Permission |
| --- | --- | --- |
| PUT | `/api/booking-options/projects/:id` | Admin |
| PUT | `/api/booking-options/destinations/:id` | Admin |
| PUT | `/api/booking-options/purposes/:id` | Admin |
| PUT | `/api/booking-options/people/:id` | Admin |

Inactive choices stay visible on existing requests but are not offered for new ones.

## Required response behavior

- Successful writes return the saved JSON object, or `204` where documented.
- Errors return an appropriate HTTP status and `{ "message": "Simple user-facing message" }`.
- Use `401` for no valid session, `403` for a role or ownership denial, `409` for scheduling/uniqueness conflicts, and `422` for validation errors.
- Perform all permission and conflict checks inside the backend transaction. Hiding frontend buttons is not security.

## Core tables

- `accounts`, `vehicles`, `login_attempts`
- `booking_options` (Projects, Destinations, Purposes) and `people`
- `requests`, `request_destinations`, `request_cancellations`
- `schedules`, `schedule_revisions`, `revision_requests`, `schedule_requests`, `schedule_legs`, `leg_stops`, `schedule_reservations` (exclusion constraints stop vehicle and Driver overlaps)
- `trip_completions`, `problem_reports`
- `audit_events` (append-only)

Full column-level detail is in `docs/ARCHITECTURE.md` and `docs/v2/phase-3-schema.md`.

Use stable opaque IDs and foreign keys. Keep timestamps in UTC and convert them only for display.

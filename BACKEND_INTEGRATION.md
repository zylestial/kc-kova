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
  "bookings": [],
  "records": [],
  "options": {
    "projects": [],
    "destinations": [],
    "purposes": []
  },
  "people": [],
  "requests": []
}
```

`requests` holds v2 transport requests (see "Requests (v2)" below), each with its active destinations in travel order and its derived `progress`. A Requester receives only their own; Scheduler and Admin receive all.

Never include password hashes or session tokens. A Driver should receive only their own assigned bookings and records. A Requester may receive all active schedule bookings but not Admin settings or Finance data.

## Accounts and Vehicles

| Method | Endpoint | Permission |
| --- | --- | --- |
| POST | `/api/accounts` | Admin |
| PUT | `/api/accounts/:accountId` | Admin |
| POST | `/api/accounts/:accountId/password` | Admin |
| POST | `/api/vehicles` | Admin |
| PUT | `/api/vehicles/:plate` | Admin |

Account usernames and Vehicle plate numbers must be unique. Use `Active` and `Inactive`; do not hard-delete rows referenced by history.

## Bookings

| Method | Endpoint | Permission |
| --- | --- | --- |
| POST | `/api/bookings` | Requester or Admin |
| PUT | `/api/bookings/:bookingId` | Owner Requester or Admin |
| DELETE | `/api/bookings/:bookingId` | Owner Requester or Admin; soft-cancel |

For new bookings, ignore any client-supplied ownership values and set these from the authenticated session:

- `createdByAccountId`
- `requestedByAccountId`
- `requestedBy`
- `createdAt`
- `status = SCHEDULED`

The backend must atomically reject overlapping active bookings for the same Vehicle or Driver. When editing, exclude the current booking from conflict checks. `DELETE` changes the status to `CANCELLED`; it does not erase the row. Cancelled bookings must not block availability.

A Requester may update or cancel only when `booking.createdByAccountId === session.account.id`. Admin is exempt from Requester ownership, but submitted or completed trips remain locked according to the workflow.

## Requests (v2)

| Method | Endpoint | Permission |
| --- | --- | --- |
| POST | `/api/requests` | Requester or Admin |
| PUT | `/api/requests/:requestId` | Owner only (Requester or Admin), while not yet scheduled |

Body (`RequestInput` in `lib/kova-api.ts`): `date`, `requestType` (`REGULAR` \| `URGENT`), optional `projectId` or `projectOther` (not both), and `destinations` — one or more `{ destinationId, purposeId }` in travel order. `PUT` also sends `rowVersion`, the version the form was opened on. There is no vehicle, Driver or time. Requested By is always the signed-in account.

The database enforces the rules (`create_request` / `update_request`): Regular at least 7 Manila calendar days ahead, Urgent today or tomorrow, 2–6 days ahead refused, Admin may also pick a past date. New choices must be Active options; an edit may keep options the request already had. Responses: `403` wrong role, `404` not the owner, `409` the request changed since the form was opened, `422` anything else (date rule, inactive option, already being scheduled) with a message to show.

## Daily Vehicle Records

| Method | Endpoint | Permission |
| --- | --- | --- |
| PUT | `/api/records/:recordId` | Assigned Driver before submission; Admin during review |

Driver submission must verify the assigned Driver, original booking relationship, scheduled-time eligibility, odometers, and ANONANG route rules. On submission, set `submittedAt` on the server and `status = SUBMITTED FOR REVIEW`. Admin edits must create immutable history entries. `DONE` records are normally read-only.

Finance fields and final PDF/print data are Admin-only. The fixed official names are:

- Project Manager: Joedel Capillan (PM)
- 2nd-Level Approval / COO: President Vargas (COO)

## Booking options

| Method | Endpoint | Permission |
| --- | --- | --- |
| PUT | `/api/booking-options/projects/:id` | Admin |
| PUT | `/api/booking-options/destinations/:id` | Admin |
| PUT | `/api/booking-options/purposes/:id` | Admin |
| PUT | `/api/booking-options/people/:id` | Admin |

Inactive choices stay visible on historical records but are not offered for new bookings.

## Required response behavior

- Successful writes return the saved JSON object, or `204` where documented.
- Errors return an appropriate HTTP status and `{ "message": "Simple user-facing message" }`.
- Use `401` for no valid session, `403` for a role or ownership denial, `409` for scheduling/uniqueness conflicts, and `422` for validation errors.
- Perform all permission and conflict checks inside the backend transaction. Hiding frontend buttons is not security.

## Suggested core tables

- `accounts`
- `sessions`
- `vehicles`
- `bookings`
- `booking_slots` or equivalent transactional conflict protection
- `daily_vehicle_records`
- `record_history`
- `destinations`
- `purposes`
- historical `projects` and `people` tables if older data uses them

Use stable opaque IDs and foreign keys. Keep timestamps in UTC and convert them only for display.

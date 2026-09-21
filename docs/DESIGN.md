# KOVA — System Design

## Data model

### `accounts`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Same value as `auth.users.id` |
| `username` | text, unique | Display login name; mapped to a synthetic email for Supabase Auth |
| `name` | text | Display name |
| `role` | text | `Booker` \| `Driver` \| `Admin` |
| `status` | text | `Active` \| `Inactive` |
| `project` | text, nullable | Free-text label, not a foreign key |
| `created_at` | timestamptz | |

### `vehicles`
| Column | Type | Notes |
| --- | --- | --- |
| `plate` | text PK | |
| `name` | text | |
| `status` | text | `Active` \| `Inactive` |

### `vehicle_aliases`
| Column | Type | Notes |
| --- | --- | --- |
| `old_plate` | text PK | |
| `new_plate` | text | FK -> `vehicles.plate`; lets an old plate keep resolving after a rename |

### `bookings`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `date` | date | |
| `plate` | text | FK -> `vehicles.plate` |
| `start_hour`, `end_hour` | smallint | `0 <= start < end <= 24` |
| `driver_id` | uuid | FK -> `accounts.id`, role must be Driver |
| `driver_name` | text | Denormalized for display without a join |
| `project` | text | |
| `requested_by_account_id` | uuid | FK -> `accounts.id` |
| `requested_by_name` | text | |
| `destination`, `purpose`, `notes` | text | |
| `created_by_account_id` | uuid | FK -> `accounts.id`; always equals the requester today |
| `created_at` | timestamptz | |
| `status` | text | `SCHEDULED` \| `CANCELLED` |

### `booking_slots`
One row per hour of an active booking. Purely an internal conflict-tracking
table — never read or written directly by API routes except through the
booking RPC functions.

| Column | Type | Notes |
| --- | --- | --- |
| `booking_id` | uuid | FK -> `bookings.id`, cascades on delete |
| `date` | date | |
| `plate` | text | |
| `driver_id` | uuid | |
| `hour` | smallint | |

Unique constraints: `(date, plate, hour)` and `(date, driver_id, hour)` —
these two indexes are the actual conflict-prevention mechanism.

### `vehicle_records`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Client-generated on first save (see `docs/ARCHITECTURE.md`) |
| `date` | date | |
| `plate` | text | |
| `data` | jsonb | Everything else — see shape below |

Unique constraint: `(date, plate)` — one record per vehicle per day.

**`data` jsonb shape** (fields referenced across `app/scheduler.tsx`,
`app/driver-trips.tsx`, `app/admin-finished-trips.tsx`,
`app/record-history.tsx`):

```jsonc
{
  "vehicle": "string",       // vehicle display name
  "driver": "string",        // driver display name
  "project": "string",
  "bookingId": "uuid",       // links back to the triggering booking
  "status": "Scheduled" | "SUBMITTED FOR REVIEW" | "DONE",
  "submittedAt": "ISO8601?", // server-set on submission only
  "start": "string",         // starting odometer, kept as a string
  "end": "string",           // ending odometer
  "legs": [
    { "requestor": "", "purpose": "", "origin": "", "destination": "",
      "out": "", "arrival": "", "contact": "", "phone": "" }
  ],
  "full": false,             // returned with a full tank
  "card": false,             // fleet card used
  "receipt": false,          // gas receipt attached
  "pm": "Joedel Capillan",   // fixed, Admin-only
  "coo": "President Vargas", // fixed, Admin-only
  "submitted": "string?",    // Finance: date submitted, Admin-only
  "received": "string?",     // Finance: received by, Admin-only
  "reference": "string?",    // Finance: reference #, Admin-only
  "finance": "Pending" | "Complete" | "Returned" | "Invalid / late",
  "financeDate": "string?",
  "history": [ /* HistoryEntry[], server-appended only */ ]
}
```

`id`, `date`, and `plate` live as real columns and are **not** duplicated
inside `data` by the API layer (`lib/supabase/mappers.ts` overlays the
column values onto the spread `data` object when reading).

### `booking_options`
| Column | Type | Notes |
| --- | --- | --- |
| `group` | text | `projects` \| `destinations` \| `purposes` |
| `id` | text | Client-generated (`crypto.randomUUID()`) |
| `name` | text | |
| `status` | text | `Active` \| `Inactive` |

PK: `(group, id)`.

### `people`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | Client-generated |
| `name` | text | |
| `project_ids` | text[] | References `booking_options` entries in the `projects` group, by convention (not FK-enforced) |
| `status` | text | `Active` \| `Inactive` |
| `account_id` | uuid, nullable | FK -> `accounts.id`, when this person also has a login |

### `login_attempts`
| Column | Type | Notes |
| --- | --- | --- |
| `key` | text PK | Lowercased username |
| `count` | integer | |
| `window_start` | timestamptz | |

Touched only by the service-role client (`lib/supabase/login-rate-limit.ts`)
— no RLS policy is granted to any other role.

## API contract

The authoritative, human-readable version of this table lives in
`BACKEND_INTEGRATION.md` at the repo root (written before implementation, as
the target the frontend adapter — `lib/kova-api.ts` — was built against).
Summary, with the implementing route file:

| Method | Path | Route file | Auth |
| --- | --- | --- | --- |
| POST | `/api/auth/sign-in` | `app/api/auth/sign-in/route.ts` | — |
| GET | `/api/auth/session` | `app/api/auth/session/route.ts` | — |
| POST | `/api/auth/sign-out` | `app/api/auth/sign-out/route.ts` | any session |
| GET | `/api/bootstrap` | `app/api/bootstrap/route.ts` | any session |
| POST | `/api/accounts` | `app/api/accounts/route.ts` | Admin |
| PUT | `/api/accounts/:accountId` | `app/api/accounts/[accountId]/route.ts` | Admin |
| POST | `/api/accounts/:accountId/password` | `app/api/accounts/[accountId]/password/route.ts` | Admin |
| POST | `/api/vehicles` | `app/api/vehicles/route.ts` | Admin |
| PUT | `/api/vehicles/:plate` | `app/api/vehicles/[plate]/route.ts` | Admin |
| POST | `/api/bookings` | `app/api/bookings/route.ts` | Booker, Admin |
| PUT | `/api/bookings/:bookingId` | `app/api/bookings/[bookingId]/route.ts` | Owner Booker, Admin |
| DELETE | `/api/bookings/:bookingId` | `app/api/bookings/[bookingId]/route.ts` | Owner Booker, Admin |
| PUT | `/api/records/:recordId` | `app/api/records/[recordId]/route.ts` | Assigned Driver (pre-submission), Admin (review) |
| PUT | `/api/booking-options/:group/:id` | `app/api/booking-options/[group]/[id]/route.ts` | Admin |
| PUT | `/api/booking-options/people/:id` | `app/api/booking-options/people/[id]/route.ts` | Admin |

Request/response bodies match the TypeScript types in `lib/kova-api.ts`
(`Account`, `Vehicle`, `Booking`, `VehicleRecord`, `BookingOption`,
`Person`, `BootstrapData`) — that file is the single source of truth for
field names and is shared between the frontend and this design doc.

## UI structure

`app/page.tsx` is the app shell: it holds sign-in, session restore, and a
simple `Screen` state machine that swaps between full-screen views — no
router/URL segments are used for in-app navigation.

| Screen | Component | Shown to |
| --- | --- | --- |
| `schedule` | `app/scheduler.tsx` | Booker (home), Admin |
| `driver-home`, `my-schedule`, `finished` | `app/driver-trips.tsx` | Driver |
| `admin-home` | `app/admin-finished-trips.tsx` | Admin |
| `driver-record`, `admin-record` | `app/scheduler.tsx` (record editor) | Driver / Admin |
| `settings` | `app/settings.tsx` | Admin (accounts, vehicles) |
| — | `app/booking-options.tsx` | Admin (projects/destinations/purposes/people) |
| — | `app/review-trip.tsx` | Admin (finished-trip detail) |
| — | `app/record-history.tsx` | Admin (read-only history viewer) |

All screens are client components (`"use client"`) that read/write through
`lib/kova-api.ts`'s in-memory cache, refreshed by re-calling
`hydrateKovaData()` (a fresh `GET /api/bootstrap`) after every mutating
call, and by listening for the `kova-data-update` window event.

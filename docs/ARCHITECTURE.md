# KOVA — Architecture

## Stack

- **Framework:** Next.js 16 (App Router, Turbopack), React 19, TypeScript,
  strict mode.
- **Backend:** Supabase — Postgres, Supabase Auth, Row Level Security (RLS),
  and Postgres RPC functions for anything that needs to be atomic.
- **Package manager:** pnpm.
- **UI:** Tailwind CSS 4, Radix UI primitives, shadcn-style components in
  `components/ui/` (vendored, not hand-edited).

## Repo layout

```
app/                    Next.js App Router: pages (client components) + API routes
  api/                  Route handlers — the only code that talks to Supabase from the server
    auth/               sign-in, session, sign-out
    bootstrap/          GET: one-shot hydration payload for the signed-in role
    accounts/           Admin: create/update accounts, reset passwords
    vehicles/           Admin: create/rename vehicles
    bookings/           Requester/Admin: create/update/cancel bookings (v1.2)
    requests/           Requester/Admin: create/edit v2 transport requests
    schedules/          Scheduler: create, save, submit, discard; Admin: approve, return
    records/            Driver/Admin: submit and review Daily Vehicle Records
    booking-options/    Admin: Projects/Destinations/Purposes/People
  *.tsx                 Screens (scheduler, driver-trips, settings, etc.) — client components
lib/
  kova-api.ts           Typed frontend adapter: every fetch to /api/**, plus client-side
                         helper logic (canManageBooking, canFinishTrip, validateDriverSubmission)
                         used for UI affordances only — never trusted as the real check
  supabase/
    server.ts           Cookie-bound Supabase client for use inside route handlers (RLS applies)
    admin.ts             Service-role client (RLS bypassed) — only for operations an
                         authenticated user's own session cannot perform
    accounts.ts          username <-> synthetic-email mapping, DB row -> Account mapping
    session.ts           requireAccount(): resolve the signed-in Account or null
    mappers.ts            snake_case DB rows -> the camelCase types in kova-api.ts
    records.ts            Vehicle record business-rule helpers (diffing, ANONANG check, etc.)
    login-rate-limit.ts    Sign-in throttling backed by the login_attempts table
supabase/
  migrations/            Schema + RLS policies + RPC functions, applied in order
docs/                    This documentation set
BACKEND_INTEGRATION.md  The API contract the frontend adapter was built against
```

## Request flow

```
Browser (React client components)
  -> lib/kova-api.ts (fetch, credentials: "include")
    -> app/api/**/route.ts (Next.js route handler, runs server-side)
      -> lib/supabase/server.ts client (cookie-scoped, RLS enforced)
         or lib/supabase/admin.ts client (service role, RLS bypassed —
         only for Auth user management and vehicle_records writes, see below)
        -> Supabase Postgres (tables + RLS policies + RPC functions)
```

The frontend never talks to Supabase directly and never holds a Supabase
key — all access goes through KOVA's own API routes, which hold the session
cookie and (for privileged operations) the service-role key.

## Authentication

Supabase Auth requires an email; KOVA accounts sign in with a **username**.
Every account therefore gets a synthetic email of the form
`<username>@accounts.kova.internal` (see `lib/supabase/accounts.ts`,
`usernameToAuthEmail`). This is purely an implementation detail of the auth
provider — usernames remain the single source of truth throughout the app,
and this mapping must be used consistently everywhere an account's Auth
identity is touched (creation, username changes, password resets).

`accounts.id` is the same UUID as the corresponding `auth.users.id` row.
Session state lives in an HttpOnly cookie set by `@supabase/ssr`; there is no
separate KOVA session table.

Sign-in attempts are rate-limited (5 failures / 15 minutes per username) via
the `login_attempts` table, touched only through the service-role client
since RLS grants it no policies at all.

## Authorization: two enforcement layers

KOVA enforces permissions in two places, and both must independently hold:

1. **Row Level Security policies** (`supabase/migrations/0001_init.sql`,
   restructured by `0007_rls_policies_per_operation.sql`) — the default and
   preferred layer. `accounts`, `vehicles`, `vehicle_aliases`,
   `booking_options`, and `people` all have a `for select` policy open to
   any authenticated user and separate `for insert` / `for update` /
   `for delete` policies (`using (is_admin((select auth.uid())))`, `insert`/
   `update` also `with check`) restricting writes to Admins. Route handlers
   for these tables use the **cookie-scoped session client** and let
   Postgres itself reject a non-Admin write — the route only does a cheap
   pre-check for a friendlier error message. Every `auth.uid()`/`auth.role()`
   call in a policy is wrapped as `(select auth.uid())` so Postgres caches
   it once per statement instead of re-evaluating it per row.

2. **Postgres RPC functions**, `security definer`, for anything that must be
   atomic across multiple rows or needs logic RLS can't express:
   - `create_booking` / `update_booking` / `cancel_booking`
     (`0002_booking_functions.sql`) — the only write path for `bookings`;
     `bookings`/`booking_slots` grant no direct write policies to anyone.
     Atomicity here is what makes double-booking impossible: each hour of a
     booking gets a row in `booking_slots`, which carries
     `unique (date, plate, hour)` and `unique (date, driver_id, hour)` — a
     concurrent conflicting insert fails the transaction outright.
   - `rename_vehicle` (`0003_vehicle_rename.sql`) — moves a vehicle's plate
     across `vehicles`, `bookings`, `booking_slots`, `vehicle_records`, and
     `vehicle_aliases` in one transaction, since `bookings.plate` has no
     `ON UPDATE CASCADE` and a multi-statement client-side rename could
     leave the tables inconsistent if interrupted.

   Every `security definer` function (`is_admin` plus the four above) sets
   `search_path = ''` with every table reference schema-qualified as
   `public.<table>` (`0006_harden_definer_functions.sql`), and is granted
   `EXECUTE` only to `authenticated` — explicitly revoked from both `PUBLIC`
   and `anon`, since Supabase's default-privilege template grants `anon`
   execute independently of `PUBLIC` (see `docs/MEMORY.md`). The two
   `0001_init.sql` trigger functions a booking insert can fire
   (`enforce_same_daily_driver`, `block_inactive_vehicle`) get the same
   `search_path=''` + schema-qualification treatment
   (`0009_fix_trigger_search_path.sql`) — a trigger invoked from inside a
   `security definer` call inherits that call's overridden search_path, not
   its own default, so this matters even though the triggers themselves
   aren't `security definer`.

3. **Application code (route handlers), using the service-role client** —
   used only where (1) and (2) aren't available or aren't the right tool:
   - **Auth user management** (`app/api/accounts/**`) — creating/updating a
     Supabase Auth user is inherently a service-role operation; the route
     performs its own Admin check before doing it, since the service-role
     client bypasses RLS entirely by design.
   - **`vehicle_records` writes** (`app/api/records/[recordId]/route.ts`) —
     this table grants no RLS write policies (by the same "writes go
     through a controlled path" pattern as bookings) but has no RPC yet
     either. The route re-implements the same discipline in TypeScript:
     resolve the signed-in account, check role/ownership/lock-state,
     validate the submission, diff and record history, then write via the
     service-role client. See `docs/RULES.md` for the exact rules enforced
     and `docs/TASKS.md` for the tracked follow-up (moving this into an RPC
     for stronger atomicity guarantees).

## Data model

### `accounts`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Same value as `auth.users.id` |
| `username` | text, unique | Display login name; mapped to a synthetic email for Supabase Auth |
| `name` | text | Display name |
| `role` | text | `Requester` \| `Scheduler` \| `Admin` \| `Driver` (v2; `Booker` is converted to `Requester` by migration 0023) |
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
| `new_plate` | text | FK -> `vehicles.plate`; lets an old plate keep resolving after a rename. Indexed (`vehicle_aliases_new_plate_idx`). |

### `bookings`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `date` | date | |
| `plate` | text | FK -> `vehicles.plate`. Indexed (`bookings_plate_idx`). |
| `start_hour`, `end_hour` | smallint | `0 <= start < end <= 24` |
| `driver_id` | uuid | FK -> `accounts.id`, role must be Driver. Indexed (`bookings_driver_id_idx`) — also the column `bookings_select`'s RLS policy filters on. |
| `driver_name` | text | Denormalized for display without a join |
| `project` | text | |
| `requested_by_account_id` | uuid | FK -> `accounts.id`. Indexed (`bookings_requested_by_account_id_idx`) — also RLS-filtered. |
| `requested_by_name` | text | |
| `destination`, `purpose`, `notes` | text | |
| `created_by_account_id` | uuid | FK -> `accounts.id`; always equals the requester today. Indexed (`bookings_created_by_account_id_idx`) — also RLS-filtered. |
| `created_at` | timestamptz | |
| `status` | text | `SCHEDULED` \| `CANCELLED` |

### `booking_slots`
One row per hour of an active booking. Purely an internal conflict-tracking
table — never read or written directly by API routes except through the
booking RPC functions.

| Column | Type | Notes |
| --- | --- | --- |
| `booking_id` | uuid | FK -> `bookings.id`, cascades on delete. Indexed (`booking_slots_booking_id_idx`). |
| `date` | date | |
| `plate` | text | |
| `driver_id` | uuid | |
| `hour` | smallint | |

Unique constraints: `(date, plate, hour)` and `(date, driver_id, hour)` —
these two indexes are the actual conflict-prevention mechanism.

### `vehicle_records`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Client-generated on first save (see "Vehicle records" below) |
| `date` | date | |
| `plate` | text | |
| `data` | jsonb | Everything else — see shape below. The `data->>'bookingId'` expression is indexed (`vehicle_records_booking_id_idx`), since both `vehicle_records_select`'s RLS policy and the booking RPCs' lock checks filter on it. |

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
| `account_id` | uuid, nullable | FK -> `accounts.id`, when this person also has a login. Indexed (`people_account_id_idx`). |

### `login_attempts`
| Column | Type | Notes |
| --- | --- | --- |
| `key` | text PK | Lowercased username |
| `count` | integer | |
| `window_start` | timestamptz | |

Touched only by the service-role client (`lib/supabase/login-rate-limit.ts`)
— no RLS policy is granted to any other role.

### v2 request/schedule tables (migrations 0013–0023)

`requests`, `request_destinations`, `request_cancellations`, `schedules`,
`schedule_revisions`, `revision_requests`, `schedule_requests`,
`schedule_legs`, `leg_stops`, `schedule_reservations`, `trip_completions`,
`problem_reports`, `audit_events`, plus the derived `request_progress`
view. `authenticated` gets `SELECT` only (filtered by RLS); every write
goes through a `security definer` RPC. The schema diagram, state
transitions, permission matrix and release order live in
`docs/v2/phase-3-schema.md`, the single source for them. The legacy
`bookings`/`booking_slots`/`vehicle_records` tables above are kept
unchanged for history.

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
| POST | `/api/bookings` | `app/api/bookings/route.ts` | Requester, Admin |
| PUT | `/api/bookings/:bookingId` | `app/api/bookings/[bookingId]/route.ts` | Owner Requester, Admin |
| DELETE | `/api/bookings/:bookingId` | `app/api/bookings/[bookingId]/route.ts` | Owner Requester, Admin |
| POST | `/api/requests` | `app/api/requests/route.ts` | Requester, Admin |
| PUT | `/api/requests/:requestId` | `app/api/requests/[requestId]/route.ts` | Owner Requester/Admin, unscheduled only |
| POST | `/api/schedules` | `app/api/schedules/route.ts` | Scheduler (Admin gets 403) |
| PUT | `/api/schedules/:scheduleId` | `app/api/schedules/[scheduleId]/route.ts` | Scheduler (DRAFT/RETURNED), Admin (SUBMITTED) |
| POST | `/api/schedules/:scheduleId/submit` | `app/api/schedules/[scheduleId]/submit/route.ts` | Scheduler |
| POST | `/api/schedules/:scheduleId/discard` | `app/api/schedules/[scheduleId]/discard/route.ts` | Scheduler |
| POST | `/api/schedules/:scheduleId/approve` | `app/api/schedules/[scheduleId]/approve/route.ts` | Admin |
| POST | `/api/schedules/:scheduleId/return` | `app/api/schedules/[scheduleId]/return/route.ts` | Admin (comment required) |
| POST | `/api/schedules/:scheduleId/cancel` | `app/api/schedules/[scheduleId]/cancel/route.ts` | Admin (reason required) |
| POST | `/api/requests/:requestId/cancel` | `app/api/requests/[requestId]/cancel/route.ts` | Owner, unscheduled request |
| POST | `/api/requests/:requestId/cancellation` | `app/api/requests/[requestId]/cancellation/route.ts` | Owner, request in a schedule |
| POST | `/api/cancellations/:cancellationId/confirm` | `app/api/cancellations/[cancellationId]/confirm/route.ts` | Admin |
| POST | `/api/cancellations/:cancellationId/decline` | `app/api/cancellations/[cancellationId]/decline/route.ts` | Admin (note required) |
| PUT | `/api/records/:recordId` | `app/api/records/[recordId]/route.ts` | Assigned Driver (pre-submission), Admin (review) |
| PUT | `/api/booking-options/:group/:id` | `app/api/booking-options/[group]/[id]/route.ts` | Admin |
| PUT | `/api/booking-options/people/:id` | `app/api/booking-options/people/[id]/route.ts` | Admin |

Request/response bodies match the TypeScript types in `lib/kova-api.ts`
(`Account`, `Vehicle`, `Booking`, `VehicleRecord`, `BookingOption`,
`Person`, `TransportRequest`, `RequestInput`, `Schedule`, `ScheduleInput`, `BootstrapData`) — that file is the single source of truth for
field names and is shared between the frontend and this doc.

## Data flow: bootstrap

`GET /api/bootstrap` is the single hydration call the frontend makes right
after sign-in. It issues parallel `select *` queries (accounts, vehicles,
bookings, vehicle_records, booking_options, people, and the v2 `requests`
with their active destinations plus `request_progress`, and the v2
`schedules` with their live versions, legs and stops) through the
**session-scoped client**, so RLS does the role-based filtering for free —
a Driver's query for `bookings` only ever returns their own rows, without
the route needing to know that rule itself. This is why `bootstrap`'s route
code contains no role branching at all.

## Environment

Configuration is entirely in environment variables (`.env.example`):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — used by the
  session-scoped client, safe to expose to the browser (nothing currently
  uses them client-side, but they're the anon key by design).
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, bypasses RLS, must never reach
  the browser.
- `NEXT_PUBLIC_KOVA_API_BASE_URL` — left blank when the API is same-origin
  (the default; this repo serves both frontend and API from one Next.js app).

All three Supabase variables are validated as present at server startup
(`instrumentation.ts` -> `lib/env.ts`) — a missing/misconfigured one fails
fast with a clear error instead of surfacing later as an opaque runtime
error the first time a route touches Supabase.

`next.config.ts` sets baseline security response headers
(`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`) on every response. A `Content-Security-Policy` header
is deliberately not set yet — see `docs/TASKS.md`.

## Deployment and migrations

CI (`.github/workflows/ci.yml`) runs `pnpm install`, `pnpm exec tsc
--noEmit`, `pnpm lint`, `pnpm test`, and `pnpm build` on every push and pull
request to `main`/`master`. Dependabot (`.github/dependabot.yml`) opens
weekly PRs for npm and GitHub Actions dependency updates.

Schema changes are new files in `supabase/migrations/`, applied in order,
never edited once applied anywhere (see `docs/RULES.md`). The intended flow
for a schema change:

1. Write the migration as a new `supabase/migrations/NNNN_description.sql`
   file.
2. Test it locally: `supabase init` (once, if `supabase/config.toml` isn't
   already present — it is, as of this repo) -> `supabase start` (requires
   Docker) -> `supabase db reset`, which applies every migration from
   `0001` onward against a disposable local Postgres instance.
3. Apply to a real project with `supabase link --project-ref <ref>` then
   `supabase db push`, which applies only migrations not yet recorded as
   applied on that project.

**Gotcha, hit for real during this project's own migration `0006`–`0009`
rollout:** `db push` tracks what's "already applied" via a migration
history table on the target project. If a table was created by some other
means (a manual SQL Editor run, a dashboard action) rather than through
`supabase db push` itself, that history table won't have a row for it, and
`db push` will try to re-run that migration and fail with a `relation
already exists` error. Fix with `supabase migration repair --status
applied <migration-id>...` for the migrations whose *tables* already exist,
before pushing the new ones. See `docs/MEMORY.md` for the full account.

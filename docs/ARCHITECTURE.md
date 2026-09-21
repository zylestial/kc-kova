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
    bookings/           Booker/Admin: create/update/cancel bookings
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

1. **Row Level Security policies** (`supabase/migrations/0001_init.sql`) —
   the default and preferred layer. `accounts`, `vehicles`,
   `vehicle_aliases`, `booking_options`, and `people` all have a
   `for select` policy open to any authenticated user and a
   `for all ... using (is_admin(auth.uid()))` policy restricting writes to
   Admins. Route handlers for these tables use the **cookie-scoped session
   client** and let Postgres itself reject a non-Admin write — the route
   only does a cheap pre-check for a friendlier error message.

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

## Data flow: bootstrap

`GET /api/bootstrap` is the single hydration call the frontend makes right
after sign-in. It issues five parallel `select *` queries (accounts,
vehicles, bookings, vehicle_records, booking_options, people) through the
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

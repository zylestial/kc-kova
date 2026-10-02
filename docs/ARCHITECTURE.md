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
    requests/           Requester/Admin: create/edit v2 transport requests
    schedules/          Scheduler: create, save, submit, discard; Admin: approve, return
    booking-options/    Admin: Projects/Destinations/Purposes
  *.tsx                 Screens (my-requests, schedules, admin-finished-trips, settings, etc.) — client components
lib/
  kova-api.ts           Typed frontend adapter: every fetch to /api/**, plus the in-memory
                         cache the screens read from
  supabase/
    server.ts           Cookie-bound Supabase client for use inside route handlers (RLS applies)
    admin.ts             Service-role client (RLS bypassed) — only for operations an
                         authenticated user's own session cannot perform
    accounts.ts          username <-> synthetic-email mapping, DB row -> Account mapping
    session.ts           requireAccount(): resolve the signed-in Account or null
    mappers.ts            snake_case DB rows -> the camelCase types in kova-api.ts
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
         only for Auth user management, see below)
        -> Supabase Postgres (tables + RLS policies + RPC functions)
```

The frontend never talks to Supabase directly and never holds a Supabase
key — all access goes through KOVA's own API routes, which hold the session
cookie and (for privileged operations) the service-role key. In-app
notifications (0035, v2.2) keep this invariant: rather than a client-side
Supabase Realtime subscription (which would need the anon key and the
user's JWT in the browser), the browser refetches `GET /api/notifications`
every 30 seconds while the tab is visible (`lib/notifications-poll.ts`).
v2.2 used a Server-Sent Events route that held a Vercel function open per
tab and queried every 4 seconds; v2.5 replaced it with this poll.

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
   preferred layer. `accounts`, `vehicles`,
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
   - The v2 RPCs (`create_request`, `save_schedule_draft`, `approve_schedule`,
     `submit_completion`, `correct_completion`, `handle_problem` and the
     rest) — the only write path for the request, schedule, completion and
     problem tables. Each locks the schedule row first so concurrent calls
     serialize; see `docs/v2/phase-3-schema.md`.
   - `rename_vehicle` (`0003_vehicle_rename.sql`, latest in `0032`) — moves
     a vehicle's plate across `vehicles`, `schedule_revisions` and
     `schedule_reservations` in one transaction, since those plates have no
     `ON UPDATE CASCADE` and a multi-statement client-side rename could
     leave the tables inconsistent if interrupted.

   Every `security definer` function (`is_admin`, `rename_vehicle` and the v2 RPCs) sets
   `search_path = ''` with every table reference schema-qualified as
   `public.<table>` (`0006_harden_definer_functions.sql`), and is granted
   `EXECUTE` only to `authenticated` — explicitly revoked from both `PUBLIC`
   and `anon`, since Supabase's default-privilege template grants `anon`
   execute independently of `PUBLIC` (see `docs/MEMORY.md`).

3. **Application code (route handlers), using the service-role client** —
   used only where (1) and (2) aren't available or aren't the right tool:
   - **Auth user management** (`app/api/accounts/**`) — creating/updating a
     Supabase Auth user is inherently a service-role operation; the route
     performs its own Admin check before doing it, since the service-role
     client bypasses RLS entirely by design.

## Data model

### `accounts`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Same value as `auth.users.id` |
| `username` | text, unique | Display login name; mapped to a synthetic email for Supabase Auth |
| `name` | text | Display name |
| `role` | text | `Requester` \| `Scheduler` \| `Admin` \| `Driver` (v2; `Booker` is converted to `Requester` by migration 0023) |
| `status` | text | `Active` \| `Inactive` |
| `project` | text, nullable | Unused since v2.5 (no screen showed it); kept for history |
| `created_at` | timestamptz | |

### `vehicles`
| Column | Type | Notes |
| --- | --- | --- |
| `plate` | text PK | |
| `name` | text | |
| `status` | text | `Active` \| `Inactive` |

### `booking_options`
| Column | Type | Notes |
| --- | --- | --- |
| `group` | text | `projects` \| `destinations` \| `purposes` |
| `id` | text | Client-generated (`crypto.randomUUID()`) |
| `name` | text | |
| `status` | text | `Active` \| `Inactive` |
| `is_other_stop` | boolean | Destinations only. A non-request stop (e.g. fuel, an errand) the Planner may add on its own; enforced by `write_revision_content`, which otherwise requires every non-final leg to serve at least one request. |

PK: `(group, id)`.

### `people`

Unused since v2.5: nothing in v2 read it, so its Settings panel and API
route were removed. The table and its rows stay (nothing is hard-deleted).

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
`docs/v2/phase-3-schema.md`, the single source for them. The v1.2
`bookings`, `booking_slots`, `vehicle_records` and `vehicle_aliases`
tables, their functions and their trigger functions were dropped by
migration 0032 (release-time only; there was no legacy data to carry over).

Since migration 0038 (v2.4), `requests` also carries `sent_back_at`,
`sent_back_by_account_id` and `sent_back_reason`: set by the
`send_back_requests` RPC when a Scheduler sends an unplaced request back
to its requester, and cleared by a trigger once the request's date changes.
`request_progress` reports such a request as `SENT_BACK`, and a trigger on
`schedule_requests` stops any schedule from including it.
`split_request` (migration 0039) moves stops a vehicle can't fit off a request
into a new request for the same requester and day.

### `notifications` (migration 0035, v2.2)

One row per (recipient, event): `account_id`, `type`, `message`,
`related_request_id`/`related_schedule_id`, `created_at`, `read_at`.
`authenticated` gets `SELECT` only, filtered by RLS to `account_id =
auth.uid()` — an account can never see another's notifications. There is
no insert/update grant for clients at all: every row is written by
`notify()`/`notify_admins()`, called from inside the existing RPC that
causes the event (`submit_schedule`, `approve_schedule`, `return_schedule`,
`request_cancellation`, `decline_cancellation`, `confirm_cancellation`,
`cancel_schedule`, `report_problem`, `send_back_requests`, `split_request`) in the same transaction as the change
itself, and `read_at` is only ever set by the `mark_notification_read`/
`mark_all_notifications_read` RPCs.

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
| POST | `/api/requests/send-back` | `app/api/requests/send-back/route.ts` | Scheduler, Admin (as Scheduler); unplaced requests only, all or nothing |
| POST | `/api/requests/:requestId/split` | `app/api/requests/[requestId]/split/route.ts` | Scheduler, Admin (as Scheduler); stops not on any live route, at least one stop left |
| POST | `/api/requests/:requestId/cancellation` | `app/api/requests/[requestId]/cancellation/route.ts` | Owner, request in a schedule |
| POST | `/api/cancellations/:cancellationId/confirm` | `app/api/cancellations/[cancellationId]/confirm/route.ts` | Admin |
| POST | `/api/cancellations/:cancellationId/decline` | `app/api/cancellations/[cancellationId]/decline/route.ts` | Admin (note required) |
| POST | `/api/schedules/:scheduleId/completion` | `app/api/schedules/[scheduleId]/completion/route.ts` | Assigned Driver (approved trip that has ended) |
| PATCH | `/api/schedules/:scheduleId/completion` | `app/api/schedules/[scheduleId]/completion/route.ts` | Admin (until Done) |
| POST | `/api/schedules/:scheduleId/completion/done` | `app/api/schedules/[scheduleId]/completion/done/route.ts` | Admin |
| POST | `/api/schedules/:scheduleId/problems` | `app/api/schedules/[scheduleId]/problems/route.ts` | Assigned Driver |
| POST | `/api/problems/:problemId/handle` | `app/api/problems/[problemId]/handle/route.ts` | Admin (note required) |
| PUT | `/api/booking-options/:group/:id` | `app/api/booking-options/[group]/[id]/route.ts` | Admin |
| GET | `/api/notifications` | `app/api/notifications/route.ts` | any session (own rows only, RLS) |
| POST | `/api/notifications/:id/read` | `app/api/notifications/[id]/read/route.ts` | any session, own notification |
| POST | `/api/notifications/read-all` | `app/api/notifications/read-all/route.ts` | any session |

Request/response bodies match the TypeScript types in `lib/kova-api.ts`
(`Account`, `Vehicle`, `BookingOption`,
`TransportRequest`, `RequestInput`, `Schedule`, `ScheduleInput`,
`TripCompletion`, `ProblemReport`, `Notification`, `BootstrapData`) — that file is the single source of truth for
field names and is shared between the frontend and this doc.

## Data flow: bootstrap

`GET /api/bootstrap` is the single hydration call the frontend makes right
after sign-in. It issues parallel `select *` queries (accounts, vehicles,
booking_options, and the v2 `requests` with their active
destinations plus `request_progress`, the `schedules` with their live
versions, legs and stops, and the completions and problem reports) through the
**session-scoped client**, so RLS does the role-based filtering for free —
a Driver's query for `trip_completions` only ever returns their own rows, without
the route needing to know that rule itself. This is why `bootstrap`'s route
code contains no role branching at all.

**Windowed since v2.5.** Requests, schedules, cancellations, completions and
problem reports load only from `?since=` on (default: the last 90 days,
`lib/bootstrap-window.ts`; the response echoes it as `since`). Anything older
that still needs someone is added back regardless: a `SUBMITTED` completion,
an `OPEN` problem report and a `PENDING` cancellation, with the schedules
and requests they belong to. `request_progress` carries `requested_date`
(0041) so Postgres evaluates `request_progress_of()` only for the window.
`loadOlderRecords()` (`lib/kova-api.ts`) asks for `since=2000-01-01` and
remembers it for later reloads; the `OlderRecordsNotice` on Finished Trips,
My requests and Schedules offers it.

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
request to `main`/`master`, and a second job starts a local Supabase
database (`supabase db start`, every migration from `0001`) and runs the
pgTAP suite (`supabase test db`) and `supabase/tests/concurrency.sh`
against it. Dependabot (`.github/dependabot.yml`) opens
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

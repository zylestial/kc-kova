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
    auth/               sign-in, session, sign-out; public link endpoints: invite,
                         accept-invite, forgot-password, reset-password, confirm-email
    me/                 The signed-in account's own email, username, password (My account)
    invites/            Admin: send a batch of invites, list, resend, cancel
    bootstrap/          GET: one-shot hydration payload for the signed-in role
    accounts/           Admin: create/update accounts, reset passwords, resend an email link
    account-emails/     Admin: every account's email for Settings
    vehicles/           Admin: create/rename vehicles
    request-groups/     Requester/Admin: create/edit a request and its stops (Daily or Company)
    requests/           Per-stop actions: cancel, send back, split, move to another day
    schedules/          Scheduler: create, save, submit, discard; Admin: approve, return;
                         Company trip recording (company-run, company-stops)
    booking-options/    Admin: Projects/Destinations/Purposes
  *.tsx                 Screens (my-requests, schedules, scheduling, admin-finished-trips, settings, etc.) — client components
  scheduler/            The Scheduling page's parts: stop cards, the options sheet, vehicle cards, the trip editor
lib/
  api-route.ts          authed(): session client + 401 + params for route handlers
  kova-api.ts           Typed frontend adapter: every fetch to /api/**, plus the in-memory
                         cache the screens read from
  request-draft.ts      The request form's state and checks (both forms)
  request-access.ts     Who may make Daily / Company requests (mirrors the SQL helpers)
  scheduling.ts         Scheduling page: what's to plan, vehicle rows, trip states, links
  scheduling-plan.ts    Where a stop can go, best first, with estimated leg times
  scheduling-edit.ts    Editing a trip's legs, and the warnings that block Submit
  scheduling-undo.ts    Undo steps for the Scheduling page
  company-trips.ts      Which stops can share a Company trip, My Trips steps
  stop-times.ts         Each leg's printed Time Out / Time In from taps and Admin entries
  supabase/
    server.ts           Cookie-bound Supabase client for use inside route handlers (RLS applies)
    admin.ts             Service-role client (RLS bypassed) — only for operations an
                         authenticated user's own session cannot perform
    accounts.ts          username <-> synthetic-email mapping, DB row -> Account mapping
    session.ts           requireAccount(): resolve the signed-in Account or null
    mappers.ts            snake_case DB rows -> the camelCase types in kova-api.ts
    login-rate-limit.ts    Sign-in throttling backed by the login_attempts table
    verify-password.ts     Checks a current password without touching the session
  mailer.ts             Account emails over SMTP (Gmail in prod, Mailpit locally); appUrl()
  email-templates.ts    The invite, confirm-email and reset-password texts
  account-tokens.ts     One-time email links: random token out, only its sha256 stored
  account-email.ts      Pending email + confirm link; an account's email status
  invites.ts            Invite links and rows
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
since RLS grants it no policies at all. The same table, with `reset:<id>`
and `confirm:<id>` keys, limits reset and confirm emails per account.

### Real emails, invites and email links (migration 0072)

The synthetic Auth email stays the sign-in identity. Each account's real
email lives in `account_emails` and is used only to deliver links, which
KOVA sends itself over SMTP (`lib/mailer.ts`), not through Supabase Auth's
mailer. Every link carries a random 32-byte token; only its sha256 is
stored, and a link is used up by a single conditional `update … where
used_at is null and expires_at > now()`, so it works once even when opened
twice at once. Links are built from `APP_URL`, never the Host header.

- **Invite** (7 days): an Admin's batch makes one `account_invites` row per
  email. `/join` sets up the account with the invite's role and
  permissions; the invite is claimed first and released again if the
  account can't be made (say, a taken username). The invited email is
  stored as confirmed.
- **Confirm email** (24 hours): a new email waits in `pending_email`, and
  the confirmed one keeps working until the link is opened. An account
  with no confirmed email sees `app/(app)/email-step.tsx` instead of KOVA.
- **Reset password** (1 hour): Forgot password takes a username or email
  and always gives the same answer. The reset page checks the password
  before using up the link, so a refused one doesn't cost it.

Changing your own username, email or password (`/api/me/*`) checks the
current password with a cookie-less client (`verify-password.ts`). A
password change ends the account's Auth sessions, so the route signs this
one in again.

`proxy.ts` lets `/join`, `/forgot-password`, `/reset-password` and
`/confirm-email` open without a session.

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
| `position` | text | 0051. Prints on the Company Trip Form; required when `can_request_company` is on |
| `driver_type` | text, nullable | 0051. Drivers only: `Truck` \| `Company car` |
| `can_request_daily` | boolean | 0051. Lets a Company car Driver make Daily requests (Requesters and Admins always can) |
| `can_request_company` | boolean | 0051. May make Company Trip requests; never for a Truck Driver |
| `created_at` | timestamptz | |

### `vehicles`
| Column | Type | Notes |
| --- | --- | --- |
| `plate` | text PK | |
| `name` | text | |
| `status` | text | `Active` \| `Inactive` |
| `company_trips` | boolean | 0051. "Can be requested for company trips": offered on the Company Trip form, never on a Daily trip |

### `booking_options`
| Column | Type | Notes |
| --- | --- | --- |
| `group` | text | `projects` \| `destinations` \| `purposes`, and since 0051 `urgent_reasons` \| `starting_points` \| `departments` \| `suppliers` \| `supervisors` \| `heads` |
| `id` | text | Client-generated (`crypto.randomUUID()`) |
| `name` | text | |
| `status` | text | `Active` \| `Inactive` |
| `is_other_stop` | boolean | Destinations only. A non-request stop (e.g. fuel, an errand) the Planner may add on its own; enforced by `write_revision_content`, which otherwise requires every non-final leg to serve at least one request. |

PK: `(group, id)`.

### `destination_locations` (migration 0044)

A destination's saved position, set by an Admin on Request choices, to
check a Driver's Arrived/Leaving taps there. Optional: a destination
without one still takes taps, unchecked. `(destination_group,
destination_id)` is the PK and an FK to `booking_options`;
`destination_group` is always `destinations`. Same RLS as
`booking_options` (everyone signed in reads, Admin writes).

Its own table on purpose: functions such as `resolve_request_project` test
a fetched option row with `v_option is not null`, which is true only when
**every** column is non-null, so a nullable column on `booking_options`
would make every option look missing.

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

### `account_emails`, `account_invites`, `account_tokens` (migration 0072)
| Table | Holds | Who reads it |
| --- | --- | --- |
| `account_emails` | One row per account: `email` (confirmed; unique), `pending_email`, `confirmed_at` | The account itself and Admins |
| `account_invites` | `email`, `role`, `driver_type`, `can_request_daily`, `can_request_company`, `token_hash`, `expires_at`, `invited_by`, `sent_at`, `accepted_account_id`/`accepted_at`, `cancelled_at`; one open invite per email | Admins |
| `account_tokens` | Confirm-email and reset-password links: `account_id`, `purpose`, `email`, `token_hash`, `expires_at`, `used_at` | Nobody (service role only) |

Emails are stored lowercase. All writes go through the service-role
client in the API routes; signed-in users get `select` only, and nothing
on `account_tokens`.

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
into a new request for the same requester and day. It's only for requests
made before request groups (0052), which can hold several stops; the
Scheduling page doesn't offer it.

On the road (0060–0064): `schedule_legs.source_leg_id` (no foreign key)
names the leg of the route the Driver follows that a draft leg came from.
When the Admin approves changes to a started trip (`trip_started`),
`approve_schedule` calls `apply_changes_on_road`, which writes the draft
onto the published version in place, so legs keep their ids and their
`stop_taps` and time corrections. `problem_reports` gains `leg_id`,
`kind` (`NOT_AVAILABLE`, `WRONG_ADDRESS`, `ROAD_BLOCKED`,
`VEHICLE_PROBLEM`, `OTHER`), `missed` (at most one per leg),
`reported_by_account_id` and an optional position, written by
`report_stop`. `schedules.paused_at` holds the trip while any of its stop
reports waits for an answer (`refresh_trip_hold`, 0068; until then only a
Vehicle problem set it); a trigger refuses stop taps while it's set.
`answer_stop_report` (0068, `POST /api/problems/:id/answer`) records a
Scheduler's or Admin's `decision` (`SKIP`, `WAIT`, `END`, `CHANGE`) and
tells the reporter (STOP_ANSWERED); only Skip makes a stop missed.
Approval of a started trip's change ends a `CHANGE` hold. `resume_trip` and
its route are gone.
`release_missed_stop` takes a missed stop's requests off the published
version and open drafts without approval, and sets `requests.missed_at`
(0065), after which `move_request_day` lets a Scheduler move it to any day
from today (also a waiting request whose day has passed). Schedulers can
read taps since 0062. 0066 adds kind `NOT_REACHED`, filed by the trigger
`trip_attendance_report_unreached` (`report_unreached_stops`) when End
trip sets `end_at`, and notification type `STOP_MISSED` for the requesters
of a missed stop (`notify_stop_missed`). 0067 adds
`problem_reports.request_ids`: a report for some of the requests at a stop
(`report_stop`'s `p_request_ids`; `missed` stays false), which
`release_missed_stop` takes off the trip alone.

### `request_groups` (migration 0052)

What a request's stops share: `number` (the 52 in 52-A), the owner, the
form (`DAILY` \| `COMPANY`), `requested_date`, and on a Company Trip the
starting point, department, `vehicle_plate`, `driver_id`, supervisor and
head (each an option id plus a name snapshot), `site_officer` and
`site_company`. Each stop is a `requests` row with `group_id`,
`stop_letter`, `urgent_reason_id`/`_name`, `details` (≤ 150),
`flexibility` (`DAY` \| `FIXED` \| `WEEK`), `fixed_time`, `contact` and
`supplier_id`/`_name`, plus `moved_at`/`moved_by_account_id` when a
Scheduler moved it to another day of its week (`move_request_day`, 0053).
Written only by `create_request_group` / `update_request_group`; read
through `can_view_request_group` (owner, Admin, Scheduler, the Company
Trip's Driver, and anyone who may see one of its stops).

`schedules.kind` (0054) is `DAILY` or `COMPANY`. `create_company_trip`
starts a Company trip; triggers on `schedule_revisions` and
`revision_requests` keep the two kinds apart (vehicle, requests, no leg
back to ANONANG on a Company trip, one department and starting point).
Since 0058 a Company Trip group's `department_id` / `department_name` is
its one Project / Site (a `projects` option), set by
`resolve_group_fields`; the `departments` list is no longer used.

Since 0057 a Scheduler's `save_schedule_draft` on a `SUBMITTED` revision
takes it back to `DRAFT` (keeping `submitted_at`) instead of refusing it,
so the Scheduling page can change a trip that's waiting for the Admin.

### `company_trip_runs` (migration 0055)

One row per Company trip: the requester's Start trip and End trip, each
with server time, the odometer, the phone's position and an address, and
who tapped. The Arrived / Leaving taps go in `stop_taps` (with the trip's
Driver as `driver_id` and the requester as `recorded_by_account_id`).
Written only by `start_company_trip`, `record_company_stop` and
`end_company_trip`; End trip also writes the `trip_completions` row. Read
by whoever can see the schedule (`can_view_schedule`). The Driver's
`trip_attendance` refuses Company trips (trigger `trip_attendance_daily_only`).

### `trip_attendance` (migration 0042, v2.6)

One row per schedule: the Driver's Start and End taps at ANONANG, their
attendance for the day. `start_at`/`end_at` are server time; `*_lat`,
`*_lng`, `*_accuracy_m` come from the phone and are null when it wouldn't
share a position; `*_distance_m` is worked out in the database by
`distance_from_base_m()` (haversine from ANONANG); `*_address` (0043) is an
approximate address the attendance route looks up from OpenStreetMap's
Nominatim (`lib/reverse-geocode.ts`) and passes to the RPC, null without a
position or when the lookup fails. `driver_id` is the
approved version's Driver; `*_recorded_by_account_id` is whoever tapped (an
Admin acting as Driver). Written only by `record_trip_attendance`;
`authenticated` gets `SELECT` only, filtered like `trip_completions` (the
Driver's own rows, Admin all). `submit_completion` requires an ended row.
Flags (away from base, no location, late) are derived in `lib/attendance.ts`,
not stored.

### `stop_taps` (migration 0045)

The Driver's Arrived (`ARRIVE`) and Leaving (`LEAVE`) taps at each
non-final leg's destination, one row per tap (unique per leg and kind).
Same columns and rules as a Start/End tap: server `at`, the phone's
`lat`/`lng`/`accuracy_m`, an `address` from Nominatim, `driver_id` the
approved version's Driver, `recorded_by_account_id` whoever tapped.
`distance_m` is from the destination's `destination_locations` row at tap
time (`distance_m()`), null without one. Written only by `record_stop_tap`;
`authenticated` gets `SELECT` only (the Driver's own rows, Admin all).

With Start/End these are the actual times on the printed form
(`lib/stop-times.ts`): leg 1 TIME OUT = Start trip, leg N TIME IN =
Arrived at leg N, leg N+1 TIME OUT = Leaving leg N, final TIME IN = End trip.

### `trip_time_corrections` (migration 0046)

An Admin's TIME OUT or TIME IN for one leg (`leg_id`, `field` `OUT`/`IN`,
`time` as Manila wall-clock `time(0)`), unique per cell. It prints in place
of the tap, which stays as evidence. Written only by `set_trip_time` (Admin,
submitted and not Done; a null time deletes it). `trip_times_missing()`
counts cells with neither a tap nor a correction; `mark_completion_done`
refuses while it's above 0. Readable by Admin and the trip's Driver.

### `notifications` (migration 0035, v2.2)

One row per (recipient, event): `account_id`, `type`, `message`,
`related_request_id`/`related_schedule_id`, `created_at`, `read_at`.
`authenticated` gets `SELECT` only, filtered by RLS to `account_id =
auth.uid()` — an account can never see another's notifications. There is
no insert/update grant for clients at all: every row is written by
`notify()`/`notify_admins()`, called from inside the existing RPC that
causes the event (`submit_schedule`, `approve_schedule`, `return_schedule`,
`request_cancellation`, `decline_cancellation`, `confirm_cancellation`,
`cancel_schedule`, `report_problem`, `send_back_requests`, `split_request`,
`report_stop`, and End trip's trigger, 0066) in the same transaction as the change
itself, and `read_at` is only ever set by the `mark_notification_read`/
`mark_all_notifications_read` RPCs.

### `push_subscriptions` and phone notifications (migrations 0069–0071)

Web Push, so the bell's notifications also pop up on a device with KOVA
closed. One row per device: its push `endpoint` (unique), keys `p256dh`
and `auth`, `user_agent`, its `account_id` and `paused_at`. A device
belongs to one account at a time; saving it from another account moves
it. `authenticated` may only `SELECT` its own rows; writes go through
`save_push_subscription` (turn on, or un-pause on sign-in: returns when
it was paused), `remove_push_subscription` (turn off) and
`pause_push_subscription` (sign-out).

Sending: an `after insert` trigger on `notifications`
(`push_new_notification`, 0070/0071) posts the new row's id through
`pg_net` to `POST /api/push/send`, only when the recipient has an
un-paused device. `pg_net` sends after commit, so a rolled-back action
sends nothing, and the trigger swallows its own errors so it can never
fail the action. The URL and a shared secret are in Vault as
`push_send_url` and `push_send_secret`; until both exist nothing is
sent. The route checks `Authorization: Bearer <PUSH_SEND_SECRET>`, loads
the row with the service-role client and sends it with the `web-push`
library (`lib/supabase/push.ts`) to each device. The tap opens the page
the bell would (`lib/notification-target.ts`, shared by both). A device
the push service answers 404/410 for is deleted.

On sign-in, a device that was paused for the same account gets the
unread notifications since it was paused, from the last 24 hours: up to
3, oldest first, or one "You have N new notifications" for more
(`catchUpMessages`, `lib/push-message.ts`). The browser side is
`public/sw.js` (shows a push, opens its page on a tap) and
`lib/push-device.ts` (permission, subscription, pause and resync).

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
| POST | `/api/accounts/:accountId/email-link` | `app/api/accounts/[accountId]/email-link/route.ts` | Admin; sends the pending email's confirm link again |
| GET | `/api/account-emails` | `app/api/account-emails/route.ts` | Admin |
| GET, POST | `/api/invites` | `app/api/invites/route.ts` | Admin; POST `{ emails, role, driverType, canRequestDaily, canRequestCompany }` → sent / skipped / invalid / failed |
| POST | `/api/invites/:inviteId/resend` | `app/api/invites/[inviteId]/resend/route.ts` | Admin |
| DELETE | `/api/invites/:inviteId` | `app/api/invites/[inviteId]/route.ts` | Admin |
| GET | `/api/auth/invite?token=` | `app/api/auth/invite/route.ts` | — (the token) |
| POST | `/api/auth/accept-invite` | `app/api/auth/accept-invite/route.ts` | — (the token); `{ token, name, username, position, password }`, ends signed in |
| POST | `/api/auth/forgot-password` | `app/api/auth/forgot-password/route.ts` | —; `{ login }`, same answer always |
| GET, POST | `/api/auth/reset-password` | `app/api/auth/reset-password/route.ts` | — (the token); POST `{ token, password }` |
| POST | `/api/auth/confirm-email` | `app/api/auth/confirm-email/route.ts` | — (the token) |
| GET, POST | `/api/me/email` | `app/api/me/email/route.ts` | any session; POST `{ email, currentPassword }` (password only when replacing a confirmed email) |
| PUT | `/api/me/username` | `app/api/me/username/route.ts` | any session; `{ username, currentPassword }` |
| POST | `/api/me/password` | `app/api/me/password/route.ts` | any session; `{ currentPassword, newPassword }` |
| POST | `/api/vehicles` | `app/api/vehicles/route.ts` | Admin |
| PUT | `/api/vehicles/:plate` | `app/api/vehicles/[plate]/route.ts` | Admin |
| POST | `/api/requests` | `app/api/requests/route.ts` | Requester, Admin |
| PUT | `/api/requests/:requestId` | `app/api/requests/[requestId]/route.ts` | Owner Requester/Admin, unscheduled only |
| POST | `/api/request-groups` | `app/api/request-groups/route.ts` | Who may make that form (`can_request_daily` / `can_request_company`); `{ form: "DAILY" \| "COMPANY", date, stops, … }` → the stops |
| PUT | `/api/request-groups/:groupId` | `app/api/request-groups/[groupId]/route.ts` | Owner, Admin; `rowVersion` required |
| POST | `/api/requests/:requestId/move` | `app/api/requests/[requestId]/move/route.ts` | Scheduler; an "any day that week" stop, `{ date }` |
| POST | `/api/schedules` | `app/api/schedules/route.ts` | Scheduler (Admin gets 403); `kind: "COMPANY"` starts a Company trip |
| PUT | `/api/schedules/:scheduleId` | `app/api/schedules/[scheduleId]/route.ts` | Scheduler (DRAFT/RETURNED, or SUBMITTED, which goes back to DRAFT; 0057), Admin (SUBMITTED) |
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
| POST | `/api/schedules/:scheduleId/completion` | `app/api/schedules/[scheduleId]/completion/route.ts` | Assigned Driver (approved trip with End trip tapped) |
| PATCH | `/api/schedules/:scheduleId/completion` | `app/api/schedules/[scheduleId]/completion/route.ts` | Admin (until Done) |
| POST | `/api/schedules/:scheduleId/completion/done` | `app/api/schedules/[scheduleId]/completion/done/route.ts` | Admin |
| POST | `/api/schedules/:scheduleId/attendance` | `app/api/schedules/[scheduleId]/attendance/route.ts` | Assigned Driver, Admin (as Driver); `{ kind: "START" \| "END", location }` |
| POST | `/api/schedules/:scheduleId/stop-taps` | `app/api/schedules/[scheduleId]/stop-taps/route.ts` | Assigned Driver, Admin (as Driver), between Start and End; `{ legId, kind: "ARRIVE" \| "LEAVE", location }` |
| POST | `/api/schedules/:scheduleId/company-run` | `app/api/schedules/[scheduleId]/company-run/route.ts` | Requester with a stop on the Company trip, Admin; `{ kind: "START" \| "END", odometer, location }` |
| POST | `/api/schedules/:scheduleId/company-stops` | `app/api/schedules/[scheduleId]/company-stops/route.ts` | Same; `{ legId, kind: "ARRIVE" \| "LEAVE", location }` |
| PUT | `/api/schedules/:scheduleId/times` | `app/api/schedules/[scheduleId]/times/route.ts` | Admin, submitted trip until Done; `{ legId, field: "OUT" \| "IN", time: "HH:MM" \| null }` |
| POST | `/api/schedules/:scheduleId/problems` | `app/api/schedules/[scheduleId]/problems/route.ts` | Assigned Driver |
| POST | `/api/schedules/:scheduleId/stop-reports` | `app/api/schedules/[scheduleId]/stop-reports/route.ts` | Whoever records the trip (Driver, Company trip requester, Admin), between Start and End; `{ legId, kind, note, location, requestIds? }` |
| POST | `/api/problems/:problemId/handle` | `app/api/problems/[problemId]/handle/route.ts` | Admin (note required); Scheduler for a stop report |
| POST | `/api/problems/:problemId/answer` | `app/api/problems/[problemId]/answer/route.ts` | Scheduler, Admin; a stop report the trip is held for, `{ decision: "SKIP" | "WAIT" | "END" | "CHANGE" }` |
| POST | `/api/problems/:problemId/missed` | `app/api/problems/[problemId]/missed/route.ts` | Scheduler, Admin; a missed stop, `{ sendBack, reason }` |
| PUT | `/api/booking-options/:group/:id` | `app/api/booking-options/[group]/[id]/route.ts` | Admin |
| GET | `/api/notifications` | `app/api/notifications/route.ts` | any session (own rows only, RLS) |
| POST | `/api/notifications/:id/read` | `app/api/notifications/[id]/read/route.ts` | any session, own notification |
| POST | `/api/notifications/read-all` | `app/api/notifications/read-all/route.ts` | any session |
| POST | `/api/push/subscription` | `app/api/push/subscription/route.ts` | any session; this device's `PushSubscription` JSON. Un-pauses it and sends what was missed |
| DELETE | `/api/push/subscription` | `app/api/push/subscription/route.ts` | any session, own device; `{ endpoint }` |
| POST | `/api/push/pause` | `app/api/push/pause/route.ts` | any session, own device; `{ endpoint }` (sign-out) |
| POST | `/api/push/test` | `app/api/push/test/route.ts` | any session; a test to the caller's own devices |
| POST | `/api/push/send` | `app/api/push/send/route.ts` | the database only (`Bearer PUSH_SEND_SECRET`); `{ notificationId }` |

Request/response bodies match the TypeScript types in `lib/kova-api.ts`
(`Account`, `Vehicle`, `BookingOption`,
`TransportRequest`, `RequestInput`, `Schedule`, `ScheduleInput`,
`TripCompletion`, `ProblemReport`, `Notification`, `BootstrapData`) — that file is the single source of truth for
field names and is shared between the frontend and this doc.

## Data flow: bootstrap

`GET /api/bootstrap` is the single hydration call the frontend makes right
after sign-in. It issues parallel `select *` queries (accounts, vehicles,
booking_options with `destination_locations`, and the v2 `requests` with their active
destinations plus `request_progress`, the `schedules` with their live
versions, legs and stops, the completions and problem reports, and the
Start/End taps, stop taps, Company trip runs and Admin time entries) through the
**session-scoped client**, so RLS does the role-based filtering for free —
a Driver's query for `trip_completions` only ever returns their own rows, without
the route needing to know that rule itself. This is why `bootstrap`'s route
code contains no role branching at all.

**Windowed since v2.5.** Requests, schedules, cancellations, completions and
problem reports load only from `?since=` on (default: the last 90 days,
`lib/bootstrap-window.ts`; the response echoes it as `since`). Anything older
that still needs someone is added back regardless: a `SUBMITTED` completion,
an `OPEN` problem report and a `PENDING` cancellation, with the schedules
and requests they belong to, and those schedules' Start/End taps, stop taps and
Admin time entries. `request_progress` carries `requested_date`
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
- Phone notifications (optional; push is off while they're blank):
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and the server-only `VAPID_PRIVATE_KEY`
  (a pair from `pnpm dlx web-push generate-vapid-keys`), `VAPID_SUBJECT`
  (a `mailto:` or `https:` contact for push services) and the server-only
  `PUSH_SEND_SECRET`. Each environment also needs the Vault secrets
  `push_send_url` (`https://<app>/api/push/send`) and `push_send_secret`
  (the same value as `PUSH_SEND_SECRET`); see 0070's header.
- Account emails (0072): `SMTP_HOST`, `SMTP_PORT` (465 means TLS from the
  start), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` and `APP_URL` (the base of
  every emailed link). Production uses a Gmail account with an App
  password; locally they point at Supabase's Mailpit (`127.0.0.1:54325`,
  read at http://127.0.0.1:54324). Without `SMTP_HOST`, development logs
  each email to the console and production refuses to send.

All three Supabase variables are validated as present at server startup
(`instrumentation.ts` -> `lib/env.ts`) — a missing/misconfigured one fails
fast with a clear error instead of surfacing later as an opaque runtime
error the first time a route touches Supabase.

`next.config.ts` sets baseline security response headers
(`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`) on every response, plus a static (non-nonce)
`Content-Security-Policy`; see `docs/MEMORY.md`, "Content-Security-Policy".

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
before pushing the new ones. See `docs/archive/MEMORY-history.md` for the full account.

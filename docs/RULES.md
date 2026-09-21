# KOVA — Business Rules

This is the canonical list of rules the backend must enforce regardless of
what the frontend does or doesn't show. Any UI-side check (in
`lib/kova-api.ts`, e.g. `canManageBooking`, `canFinishTrip`,
`validateDriverSubmission`) exists only to shape the experience — it is
never a substitute for the check listed here.

(The domain rules below are followed by an "Engineering & agent
conventions" section — how code and Supabase schema changes in this repo
should be written, for both humans and AI agents.)

## Accounts

- Only an Admin may create, edit, or reset the password of an account.
- `username` is unique across all accounts (enforced by the `accounts`
  table's `unique` constraint and, transitively, by the synthetic Auth
  email's uniqueness).
- `role` is exactly one of `Booker`, `Driver`, `Admin`.
- `status` is `Active` or `Inactive`. Accounts are never hard-deleted.
- An inactive account cannot sign in (`sign-in` and `session` both treat a
  non-Active account as "no session" and sign it out).
- Passwords are never stored or returned by KOVA's own code — Supabase Auth
  owns the credential.

## Vehicles

- Only an Admin may create or edit vehicles.
- `plate` is the primary key and must be unique.
- Renaming a plate (`PUT /api/vehicles/:plate` with a different `plate` in
  the body) must not orphan history: every booking, booking slot, and
  vehicle record referencing the old plate is moved to the new one, and the
  old plate is recorded in `vehicle_aliases` so historical lookups still
  resolve. See `rename_vehicle` in `docs/ARCHITECTURE.md`.
- A booking cannot be created against an `Inactive` vehicle
  (`block_inactive_vehicle` trigger).
- Vehicles are never hard-deleted, only marked `Inactive`.

## Bookings

- A booking may be created by a `Booker` or an `Admin`. A `Driver` may never
  create a booking (including for themselves).
- `driverId` must reference an **Active** account with role `Driver`.
- `start`/`end` are hours in `[0, 24)` / `(0, 24]` with `start < end`.
- **No overlapping active booking for the same vehicle, and none for the
  same driver, may exist for any overlapping hour on the same day.** This is
  enforced atomically by unique indexes on the `booking_slots` table (one
  row per booked hour), not by an application-level check-then-insert —
  a race between two concurrent requests must never let both succeed.
- All bookings for the same vehicle on the same date must share the same
  driver (`enforce_same_daily_driver` trigger) — a vehicle's day belongs to
  one driver, who files one Daily Vehicle Record covering every trip that
  vehicle makes that day.
- On creation, the server — never the client — sets `createdByAccountId`,
  `requestedByAccountId`, `requestedBy` (name), `createdAt`, and
  `status = SCHEDULED`, all derived from the authenticated session.
- A Booker may update or cancel a booking only if they created it
  (`createdByAccountId === session.account.id`). An Admin may update or
  cancel any booking.
- A booking that already has a **submitted** Daily Vehicle Record
  (`vehicle_records.data->>'submittedAt' is not null`) can no longer be
  edited or cancelled by anyone, Admin included — the trip is locked once
  the Driver has filed it.
- Cancelling sets `status = CANCELLED`; the row is never deleted, and its
  hour slots are freed immediately so the vehicle/driver become bookable
  again for that time.
- A cancelled booking never counts toward availability checks.

## Daily Vehicle Records

- One record row exists per `(date, plate)` — every booking for that
  vehicle on that day shares the one record, consistent with the
  one-driver-per-vehicle-per-day rule above.
- **Before submission:** only the assigned Driver of the linked booking may
  write to the record, and only while it has no `submittedAt`.
- **Submission** (`status` set to `SUBMITTED FOR REVIEW`) requires, checked
  server-side:
  - the actor is the booking's assigned driver;
  - the booking is still `SCHEDULED` and its scheduled end time has already
    passed (`canFinishTrip`);
  - start and end odometer readings are present, numeric, non-negative, and
    `end >= start`;
  - the trip's leg list is non-empty and **starts and ends at ANONANG**
    (case-insensitive), the fleet's home base.
  - On success, the server — not the client — sets `submittedAt` to the
    current time and the status to `SUBMITTED FOR REVIEW`.
- **After submission:** the Driver may no longer write to the record at
  all. Only an Admin may, and only while `status !== "DONE"`.
- **Admin edits** to a submitted record must append an immutable history
  entry (`action: "EDIT"`) recording every changed field's before/after
  value, the acting Admin's id/name, and a timestamp. History entries are
  never edited or removed once written.
- **Marking Done** (`status` set to `DONE`) is Admin-only, only legal from
  `SUBMITTED FOR REVIEW`, and appends a history entry with
  `action: "MARK AS DONE"`.
- **Once `DONE`, a record is read-only** — no further writes from anyone,
  Admin included, through the normal edit path.
- Finance fields (`submitted`, `received`, `reference`, `finance`,
  `financeDate`) and the fixed approval names (`pm`, `coo`) are Admin-only:
  a Driver's payload must never be able to set or change them, even if
  present in the request body.
- The two fixed approval names never change: Project Manager is
  **Joedel Capillan (PM)**; 2nd-level/COO approval is
  **President Vargas (COO)**.

## Booking options and people

- Only an Admin may create or edit Projects, Destinations, Purposes, or
  People.
- Inactive options remain visible on historical bookings/records but must
  not be offered when creating a *new* booking.
- Nothing in this group is ever hard-deleted.

## Cross-cutting

- **Every** permission and conflict check runs inside the backend request,
  never only in the UI. Hiding a button is not a security control.
- HTTP status conventions (see `BACKEND_INTEGRATION.md`): `401` no valid
  session, `403` role/ownership denial, `409` scheduling or uniqueness
  conflict, `422` validation failure. Successful writes return the saved
  resource as JSON, or `204` where documented (sign-out, cancel, password
  reset).
- Sign-in is rate-limited (5 failed attempts / 15 minutes per username) to
  slow down credential guessing.

## Engineering & agent conventions

These apply to any change in this repo, human or AI-agent-authored.
Several were learned the hard way during this project's own security/perf
audit — see `docs/MEMORY.md` for the full incidents.

### Code

- TypeScript strict mode; no new `any` (none currently exist — keep it
  that way).
- Route handlers (`app/api/**/route.ts`) are the *only* code that talks to
  Supabase from the server. Screens (`app/*.tsx`) go through
  `lib/kova-api.ts`, never Supabase directly.
- `components/ui/` (vendored shadcn/Radix) is not hand-edited; screen
  styling lives in `app/globals.css`.
- **Check every Supabase `{ data, error }` result.** A route that
  destructures only `data` and ignores `error` can silently render empty
  results as if they were real ("0 vehicles") instead of surfacing the
  actual failure — this was a real bug found and fixed in `GET
  /api/bootstrap` during this audit.
- Validate all external input (request bodies, params) at the route
  boundary before using it — every existing route does this with manual
  `typeof body?.x === "..."` checks; keep that pattern consistent on new
  routes (a repo-wide move to a schema validator like `zod` is a tracked,
  not-yet-done follow-up — see `docs/TASKS.md`).
- When a value is looked up by one identifier but written using other
  attacker-influenceable fields from the same request, verify those fields
  are actually consistent with the looked-up row — don't assume ownership
  of *one* field (e.g. a booking id) implies the request's *other* fields
  (date/plate) are safe to trust. This was the root cause of the
  `vehicle_records` date/plate-spoofing bug fixed in Phase 2.

### Supabase / migrations

- **Every table in `public` has RLS enabled, default-deny.** No table ships
  without RLS; a table with RLS enabled and zero policies denies everyone
  by default, which is intentional for internal tables like
  `booking_slots`/`login_attempts` that should only ever be touched via an
  RPC or the service-role client.
- **Write explicit per-operation policies** (`for select`/`for insert`/`for
  update`/`for delete`), not a single `for all`, so each operation's rule
  is independently readable — `insert`/`update` need `with check`, not just
  `using`.
- **Wrap `auth.uid()`/`auth.role()` calls in policies as `(select
  auth.uid())`** — Postgres then evaluates it once per statement (an
  initplan) instead of once per row.
- **`SECURITY DEFINER` functions set `search_path = ''`** with every table
  reference schema-qualified (`public.<table>`), not `search_path =
  'public'`. This also applies to any *trigger* function a `security
  definer` call can fire — a trigger invoked from inside such a call
  inherits the caller's overridden search_path, not its own default. Check
  authorization *inside* the function body (`auth.uid()` + a role/status
  lookup), never assume RLS alone covers what a `security definer`
  function does.
- **`revoke execute ... from public` is not sufficient on its own.**
  Supabase's project template applies `alter default privileges` to grant
  `EXECUTE` to `anon`/`authenticated`/`service_role` independently of
  `PUBLIC` for functions created by `postgres`/`supabase_admin`. Revoke
  from `anon` explicitly too if a function shouldn't be anonymously
  callable, then grant back only to the roles that need it.
- **`service_role` is server-only** (`lib/supabase/admin.ts`), never sent
  to the browser, never used from a client component. The anon/publishable
  key is the only Supabase credential the browser may ever see — and in
  this repo, the browser doesn't even hold that, since `lib/kova-api.ts`
  talks to KOVA's own API routes, never Supabase directly (see
  `docs/ARCHITECTURE.md`).
- **Authorization uses a roles table (`accounts.role`), never
  `user_metadata`.** `user_metadata` is user-editable via the client SDK
  and must never gate permissions; this repo's `is_admin()` and every RPC
  check `accounts.role`/`accounts.status` instead.
- **Add indexes on every foreign key and every column an RLS policy
  filters on.** Postgres does not auto-index the referencing side of a
  foreign key.
- **All schema changes are new files in `supabase/migrations/`.** Never
  edit a migration that may already be applied anywhere (local, dev, or
  production) — if it needs fixing, write a new migration. Confirm what's
  actually applied before assuming: `supabase migration list --linked` can
  show tables that already exist but aren't recorded as applied.
- **Test migrations with `supabase db reset` locally before applying
  anywhere else.** This is disposable (Docker-based) and doesn't need any
  cloud project. It won't catch everything — an expression index that's
  fine against an empty local database can still fail against real data
  with unexpected values, so also check assumptions about existing data
  before pushing to a project that has any.
- No generated-types workflow (`supabase gen types typescript`) is set up
  in this repo yet; Supabase row types are hand-written per-file (e.g.
  `lib/supabase/mappers.ts`). If that changes, keep the generated types and
  the mapping layer in sync deliberately, not by inspection.

### Security

- Never commit secrets. `.env.example` holds placeholders only, `.env*` is
  gitignored (`.env.example` excepted), and local database dumps
  (`*.sql` outside `supabase/migrations/`) are gitignored too, since a
  data dump can contain real credentials/session tokens.
- Never paste a real password, connection string with credentials, or
  access token into a chat/agent session — it persists in that session's
  history. If one is exposed this way, rotate it.
- Passwords are never stored or returned by KOVA's own code; Supabase Auth
  owns the credential.

### Testing

- Run `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm test`, and `pnpm build`
  after every change, before committing; don't commit code known to be
  broken.
- Add or update a test for every bug fix and security fix (see
  `lib/supabase/records.test.ts`'s `matchesBookingKey` tests for the
  pattern: a pure helper function, unit-tested, called from the route).

### Git / PR conventions

Full detail lives in `CLAUDE.md`'s "Git commits" section (the operational
instructions an AI agent in this repo follows every session); summary for
any contributor:

- Small, logical, separately-committed changes — one concern per commit.
- Imperative-mood subject lines, 50 characters or fewer.
- Never edit an already-applied Supabase migration; never force-push,
  rebase, or rewrite history on a shared branch without being asked.
- Confirm before starting a multi-step plan, not just before its
  individual steps.

### Prohibited approaches

- Never disable a lint rule, type check, or test to make something pass.
- Never run destructive database commands (`DROP`, `TRUNCATE`, deleting
  migrations or data) against a production project. Use local Supabase or
  a dev/branch project, and always confirm with a human before touching
  production.
- Never trust a client-supplied value for anything the server can derive
  itself (ownership ids, timestamps, status transitions) — set them
  server-side, the same discipline already used throughout
  `app/api/bookings/**` and `app/api/records/**`.

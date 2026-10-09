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
- `role` is exactly one of `Requester`, `Scheduler`, `Admin`, `Driver`. The
  retired v1.2 value `Booker` is rejected everywhere, never accepted as an
  alias (see `docs/v2/phase-3-schema.md`).
- `status` is `Active` or `Inactive`. Accounts are never hard-deleted.
- An inactive account cannot sign in (`sign-in` and `session` both treat a
  non-Active account as "no session" and sign it out).
- Passwords are never stored or returned by KOVA's own code — Supabase Auth
  owns the credential.

## Vehicles

- Only an Admin may create or edit vehicles.
- `plate` is the primary key and must be unique.
- Renaming a plate (`PUT /api/vehicles/:plate` with a different `plate` in
  the body) must not orphan history: every schedule version and reservation
  referencing the old plate is moved to the new one in one transaction. See
  `rename_vehicle` in `docs/ARCHITECTURE.md`.
- A schedule cannot be saved against an `Inactive` vehicle
  (`save_schedule_draft`) or approved once its vehicle has become inactive
  (`approve_schedule`).
- Vehicles are never hard-deleted, only marked `Inactive`.

## Requests, schedules and completions (v2)

The v1.2 booking and Daily Vehicle Record rules were retired with their code
and tables (migration 0032). Request and schedule rules (dates, states,
approval, cancellation, conflicts) are enforced in the RPCs and documented
per phase in `docs/v2/` — `phase-3-schema.md` has the permission matrix and
state transitions. The completion rules:

- Only the Driver snapshotted on a schedule's **approved** version may submit
  a completion or report a problem, and only while the schedule is `ACTIVE`.
- A completion is **one odometer pair for the whole schedule**: whole numbers,
  start ≥ 0, end ≥ start, pinned to the approved version, with a server-set
  `submitted_at`. Repeating a submit returns the existing completion.
- The trip must be over: the approved version's last planned Time In
  (Asia/Manila) has passed, and the Driver has tapped Start and End (below). Problem reports have no such limit, can be filed
  more than once, and never block anything.
- A submitted completion locks the trip: no revision, approval or
  cancellation afterwards.
- Only an **Admin** may correct a completion (while `SUBMITTED`), mark it
  `DONE`, or handle a problem report. Marking Done is always a manual action.
  A `DONE` completion is locked for everyone, the service role included
  (trigger `prevent_done_completion_changes`); repeating Done returns it.
- Handling a problem report needs a note and may name a follow-up schedule,
  which must be a different, active schedule. A `DONE` trip can still have
  problem reports handled.

The attendance rules (`record_trip_attendance`, migration 0042):

- One Start and one End tap per schedule, by the approved version's Driver
  or an Admin acting as Driver (audited as an override; the row stays the
  Driver's and records who tapped). The schedule must be `ACTIVE` and not yet
  submitted.
- Start opens on the trip's date (Asia/Manila), never before; End needs
  Start. Repeating a tap returns the first one unchanged.
- The time is always the server's. The position is optional and comes from
  the phone; the database works out the distance from ANONANG
  (16.103769, 120.436222). A tap that couldn't be within 150 m (its
  distance minus the phone's reported accuracy, counting at most 250 m of
  accuracy), without a position, or on a later day than the trip is flagged
  on screen, never refused. The phone listens for up to 10 seconds and
  sends its most accurate reading (stopping early at ±50 m).
- A tap with a position also gets an approximate address (0043), looked up
  once by the API route from OpenStreetMap (Nominatim), never taken from
  the browser. A failed or slow lookup (over 4 seconds) saves the tap
  without one; a tap without a position never has one.
- Only Admin and the Driver themself can read a Driver's attendance.

The stop-time rules (`record_stop_tap`, `set_trip_time`, migrations
0044–0046):

- Between Start trip and End trip, the Driver taps Arrived on reaching each
  non-final leg's destination and Leaving on setting off from it; End trip
  is the final leg's arrival. One of each per leg, by the same people as
  Start/End; a repeat returns the first. Refused before Start trip, after
  End trip, once the trip is submitted, and on a leg not in the approved
  version.
- These are the actual times on the printed form: leg 1 TIME OUT = Start
  trip, leg N TIME IN = Arrived at leg N, leg N+1 TIME OUT = Leaving leg N,
  final TIME IN = End trip. Planned times stay on the Trip Record only.
- Same position rules as Start/End, measured from the destination's saved
  location when it has one (Request choices); without one, or for a typed-in
  "other" destination, the tap is kept as "location not checked". Flagged,
  never refused. Whether the Driver was on time is not judged.
- My Schedule offers the next tap in route order and the one after it, so a
  forgotten Arrived can be passed by tapping Leaving (and so on).
- After the Driver submits, an Admin can fill in a missing time or correct
  one (`set_trip_time`, to the minute, Manila time). It prints instead of
  the tap; the tap stays on record. Clearing it brings back the tap (or the
  blank). Locked once the trip is Done.
- **A trip can't be marked Done until every TIME OUT and TIME IN is there**,
  tapped or filled in (`trip_times_missing`). The Driver is never blocked:
  Complete trip doesn't need the stop taps. "Mark clean trips done" skips
  trips with a time missing. A time nobody recorded prints blank.

## Booking options

- Only an Admin may create or edit Projects, Destinations or Purposes.
- Inactive options remain visible on existing requests but must not be
  offered when creating a *new* one (an edit may keep an option the request
  already had).
- Nothing in this group is ever hard-deleted.
- A Destination may have a saved location (coordinates or a Google Maps
  link, pasted on Request choices), used only to check stop taps there.
  Clearing it deletes the `destination_locations` row; the option stays.
  Never add a nullable column to `booking_options` itself (see
  `docs/ARCHITECTURE.md`, `destination_locations`).

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
audit — see `docs/MEMORY.md` and `docs/archive/MEMORY-history.md` for the full incidents.

### Code

- TypeScript strict mode; no new `any` (none currently exist — keep it
  that way).
- Route handlers (`app/api/**/route.ts`) are the *only* code that talks to
  Supabase from the server. Screens (`app/*.tsx`) go through
  `lib/kova-api.ts`, never Supabase directly.
- A route that needs a signed-in account is written as
  `export const POST = authed<{ id: string }>(async ({ request, supabase, account, params }) => { ... })`
  (`lib/api-route.ts`). `authed` builds the cookie-scoped client, answers
  `401` when there is no Active account and resolves the params, so a new
  route can't forget the check. Only the auth routes (sign-in, session,
  sign-out) are written without it.
- `components/ui/` (vendored shadcn/Radix) is not hand-edited; screen
  styling lives in `app/globals.css`.
- **Check every Supabase `{ data, error }` result.** A route that
  destructures only `data` and ignores `error` can silently render empty
  results as if they were real ("0 vehicles") instead of surfacing the
  actual failure — this was a real bug found and fixed in `GET
  /api/bootstrap` during this audit.
- Validate all external input (request bodies, params) at the route
  boundary before using it, with a `zod` schema: read the body with
  `readJson` (`lib/api-route.ts`) and check it with `parseWith`
  (`lib/validation.ts`), which returns `null` for a 422. Reuse the shared
  pieces there (`text`, `trimmedText`, `isoDate`, `rowVersion`) and the
  domain schemas in `lib/*-input.ts`. Schemas check shape only; business
  rules stay in Postgres.
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
  `login_attempts` that should only ever be touched via an
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
- Database behavior (RLS, RPC permissions, state transitions) is tested
  with pgTAP in `supabase/tests/*.test.sql` (`supabase test db`), and
  races with two real sessions in `supabase/tests/concurrency.sh`. CI runs
  both on every PR against a fresh database; locally they need the Docker
  database and a `supabase db reset` first (demo data such as `req1`
  collides with the test fixtures). Scope assertions to the test's own
  fixtures rather than whole tables, because the concurrency script leaves
  committed rows behind.
- Add or update a test for every bug fix and security fix (see
  `lib/completion-input.test.ts` for the pattern: a pure helper function,
  unit-tested, called from the route).

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
  `app/api/requests/**` and `app/api/schedules/**`.

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

- Only an Admin may invite people, edit an account's name, role, status,
  position and request permissions, or reset its password. An invite is
  the only way to make an account (there is no Add Account).
- **Invites** (0072): an Admin invites a batch of emails with one role and
  set of request permissions. The person sets up their own name, username
  and password from the link, plus a Position only when their access needs
  one: required with company trips, optional for an Admin, not asked
  otherwise (`lib/invite-fields.ts`). They can never change their role or
  permissions there. A link works once, for 7 days; Resend makes a new one
  and the old stops working. An email that already has an account, or an
  open invite, is skipped.
- **Every account has a confirmed email** (0072): the invited one, since
  invites are the only way in. (Accounts from before 0072 have none until
  they add one on My account; the site is to be reset before real use.)
  A new email stays pending, and the confirmed one keeps working, until
  its link is opened. Two accounts can't share an email. Only the account
  itself and Admins can see it.
- **Self-service** (0072): anyone can change their own username, email and
  password on My account, each with their current password; wrong ones
  count toward the sign-in lockout. A new username can't be inside the
  current password. Forgot password emails a link (1 hour, once) to the
  confirmed email, found by username or email, and answers the same
  whether or not the account exists; at most 5 such emails per account per
  15 minutes. Setting a password from the link also lifts a sign-in lockout.
- A username someone chooses themselves is 3–30 letters, numbers, dots,
  dashes or underscores (`lib/username-policy.ts`).
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
- **Who may request what** (0051, 0074; `can_request_daily`,
  `can_request_company`, `can_request_transport`, mirrored for the menus in
  `lib/request-access.ts`): Requesters and Admins can always make Daily
  requests. Every Admin can make Company trips too (0059, owner's call
  2026-10-16; its Position prints if set). Anyone else needs "Can request
  company trips" on the account, and that needs a Position (it prints on
  the Company Trip Form).
- A Driver is a **Truck** or a **Company car** Driver (`driver_type`; a new
  Driver starts as Truck). A Driver can't make requests unless an Admin
  allows that account, with Daily requests and Company trips switched on
  separately. A Truck Driver can never be allowed. Someone who stops being
  a Driver loses the Driver-only fields (trigger
  `accounts_normalize_driver_fields`).
- A **Scheduler** gets the same two switches as a Company car Driver
  (0074, owner's call 2026-10-20), both off until an Admin turns them on.
  A Scheduler may plan a trip that carries their own request; the Admin
  still approves it. Someone who stops being a Scheduler or Driver loses
  the Daily switch.
- **Finance** (0075, 0076, owner's call 2026-10-20) is its own account
  type. It reads every trip, its finished-trip details (odometers, fuel
  checks, corrected times, problem reports, stop taps) and attendance, and
  prints and downloads them, but changes nothing: every write RPC checks
  the role and refuses it. Cancellation asks and audit events stay
  Admin-only. It has the same two request switches as a Scheduler.

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
- A vehicle that **can be requested for company trips** (`company_trips`,
  off by default) is offered only on the Company Trip form and under
  Company trips on the Scheduling page, never on a Daily trip (trigger
  `schedule_revisions_kind_vehicle`, 0054). Every vehicle is a company
  vehicle; never call the others "non-company".

## Requests, schedules and completions (v2)

The v1.2 booking and Daily Vehicle Record rules were retired with their code
and tables (migration 0032). Request and schedule rules (dates, states,
approval, cancellation, conflicts) are enforced in the RPCs and documented
per phase in `docs/v2/` — `phase-3-schema.md` has the permission matrix and
state transitions.

**One trip per vehicle per day** (migration 0048, owner's call 2026-10-09;
Daily trips only since 0054): once a vehicle is on an active Daily schedule
for a day (any live version, timed or not), no other schedule may use it
that day, even at other times. A schedule keeps its own vehicle across
revisions; cancelling or discarding it frees the vehicle. Enforced by a
trigger on `schedule_revisions`; the Scheduling page only offers to add to
that trip (`planOn` in `lib/scheduling-plan.ts`).

**Scheduling page** (`/scheduling`, owner's calls 2026-10-14/15). The
database stays the authority; these are the page's own rules:

- **Changing a trip waiting for the Admin takes it back** (0057): a
  Scheduler's `save_schedule_draft` on a `SUBMITTED` revision puts it back
  to `DRAFT`, keeping `submitted_at`, so the page offers "Resubmit for
  approval"; the Admin sees it again only once it's resubmitted. An Admin
  editing a `SUBMITTED` revision still leaves it `SUBMITTED`.
- An approved trip's legs are locked until the Scheduler presses **Propose
  changes** (a new draft version; the approved times stay in effect until
  the Admin approves the change).
- **Warnings block Submit** (`tripChecks` in `lib/scheduling-edit.ts`): a
  leg whose Time In is too soon to drive there, a Time Out before the leg
  before it arrives, a fixed-time stop reached more than 5 minutes off its
  time, more than 8 legs, and a Daily trip that doesn't end at ANONANG.
  There's no end of day (owner's call 2026-10-16: vehicles run any hour,
  Daily or Company); a trip still fits in one calendar day, since its
  times are Time Out / Time In on that date.
- **Adding a stop** (`planOn`): a Daily vehicle needs an assigned Driver and
  takes one trip a day, so a stop joins that trip (not once it's on the
  road). A Company stop goes only on the vehicle its requester picked,
  joining that vehicle's trip for the same department, Driver and starting
  point if one hasn't started yet, otherwise as a new trip at least 15
  minutes after the vehicle's last one. A Company request's stops keep the
  requester's order (52-A before 52-B).
- Changing a leg's Time Out moves its Time In by the same amount (the leg
  keeps its length); changing Time In changes only Time In. Later legs
  without a typed time are estimated again.
- **Taking a stop off** (Remove on its leg) sends it back to the waiting
  list, or back to its requester with a reason (`send_back_requests`).
- **Undo** reverses the Scheduler's changes on the page one at a time,
  moved "any day that week" stops included; it can't undo a submit or a
  send-back.
- Older requests with several destinations can't be split on this page
  (`split_request` stays in the API); every request since 0052 has one stop.

The request rules (`create_request_group`, `update_request_group`,
`write_request_stop`, 0052; owner's calls 2026-10-14):

- A request is a **group of stops**, numbered 52-A, 52-B, … Each stop is
  its own `requests` row with one destination, so stops can go on different
  vehicles or days. The group holds the form (Daily Vehicle Trip or Company
  Trip), the date and the Company Trip's fields. At most 20 stops.
- Per stop: Project / Site, destination, purpose (or an Urgent reason),
  Details, how flexible it is (any time that day, a fixed time with the
  appointment time, or any day that week), a contact and, on a Company
  Trip, an optional supplier. Choices must be active (an edit may keep one
  the stop already had).
- **Urgent is per stop, with a reason** from the Admin's Urgent reasons.
  The date no longer decides Regular or Urgent (the 7-day rule is gone);
  `request_type` is set from whether the stop has a reason.
- **Details** (what exactly, at most 150 characters) are required for Pick
  up, Delivery and Urgent stops, optional otherwise.
- Any date from today on; only an Admin may pick a past date.
- Once any stop is being scheduled, the group's date and trip fields can't
  change; a stop already being scheduled can't be edited or removed (ask
  for its cancellation instead).
- **Moving a stop** (`move_request_day`, 0053): only a Scheduler, only a
  stop the requester marked "any day that week", only to Monday–Saturday of
  that week, not a past day, and not while it's in a schedule. The
  requester gets a REQUEST_MOVED notification. The stop keeps the asked-for
  date on its group.
- `create_request` / `update_request` (0051) stay for older requests; the
  app's forms use the group RPCs.

The Company trip rules (`create_request_group` with `COMPANY`, 0052;
`create_company_trip` and the triggers in 0054):

- A Company Trip request names a starting point, a vehicle that can be
  requested for company trips, an active Company car
  Driver, an Immediate Supervisor and a PM / CM / Dept. Head; the site
  officer and site company are optional. All its stops have one Project /
  Site, and that is its department / site (0058, owner's call 2026-10-15):
  it prints as the department and decides the "one department per trip"
  rule. The separate Departments / Sites list is hidden; groups made before
  0058 keep the department they had.
- A Company trip (`schedules.kind = 'COMPANY'`) takes only Company Trip
  requests, all with the same vehicle, Driver, department and starting
  point; the vehicle and Driver are the requester's, never the Scheduler's.
  Its first leg starts at the starting point and its last leg ends at the
  last stop: no leg back to ANONANG. A Company Trip request can't go on a
  Daily trip.
- A vehicle may take several Company trips a day as long as their times
  don't overlap (`schedule_reservations`). Approval, return, revision and
  cancellation work as for Daily trips.
- **The requester records it** (`start_company_trip`,
  `record_company_stop`, `end_company_trip`, 0055): anyone with a stop on
  the trip, or an Admin for them (audited as an override). Start trip needs
  the starting odometer and opens on the trip's date (0056); then Arrived and
  Leaving at each stop but the last, in route order; End trip on arriving
  at the last stop needs the ending odometer, never lower than the start.
  A vehicle without an odometer (0078) takes no readings at either end;
  End trip follows Start, so a trip started without one ends without one.
  Server time, optional phone position, flagged never refused; a repeat tap
  returns the first. End trip submits the trip (a `trip_completions` row),
  so it goes to Finished Trips like any other.
- **Not in Attendance**: the Driver's Start/End trip refuses a Company trip
  (trigger `trip_attendance_daily_only`), and the Driver only sees it.
- On the Company Trip Form leg 1 TIME OUT is Start trip, leg N TIME IN is
  Arrived at leg N (End trip for the last), leg N+1 TIME OUT is Leaving
  leg N. `trip_times_missing` counts them the same way, so Done needs them
  all.

The completion rules:

- Only the Driver snapshotted on a schedule's **approved** version may submit
  a completion or report a problem, and only while the schedule is `ACTIVE`.
- A completion is **one odometer pair for the whole schedule**: whole numbers,
  start ≥ 0, end ≥ start, pinned to the approved version, with a server-set
  `submitted_at`. Repeating a submit returns the existing completion.
- **Vehicles without an odometer** (`vehicles.has_odometer` off, 0078,
  Settings → Vehicles → "Has an odometer"): the completion has no readings
  (both null; never one without the other), Complete trip skips straight to
  the final return, and screens and printed forms say "No odometer" / "N/A".
  Whether readings are needed is read from the vehicle when the trip is
  completed. A vehicle with one still needs both, as before.
- The trip must be over: the Driver has tapped Start and End (below). Since
  0047 End trip is enough, so a trip back early can be completed before its
  last planned Time In. Problem reports have no such limit, can be filed
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
- The time is the server's, except for a tap made with no signal (0077):
  the phone keeps it with the time it was tapped and sends it once it can,
  in order, through the RPC's `_at` twin. The database takes that time only
  within bounds: never after its own now, never before the step it follows
  (the trip day's midnight for Start; the trip's start or last stop tap for
  a stop tap or End), and notes when it arrived (`*sent_at`). This applies
  to every trip tap: Start/End, Arrived/Leaving and a Company trip's. A
  saved tap KOVA then refuses (the trip was cancelled meanwhile, say) is
  dropped and listed on the trip screen. The position is optional and comes from
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
  "other" destination, the tap is kept and flagged "No location set for …"
  (counted as "not checked" on Attendance, with its own filter). The Admin
  screens check each tap against the destination's location as it is now
  (`placeResolver`; a typed-in leg matches its choice by name), so setting a
  location later checks earlier taps too. Flagged,
  never refused. Whether the Driver was on time is not judged.
- My Schedule shows one button at a time: the next tap in route order. A
  Driver who forgot one taps the next as usual; the missed one shows as
  skipped and the Admin fills it in. "End trip now" (with a second tap to
  confirm) ends a trip cut short. Drivers never see distances, coordinates
  or flags; only the Admin does.
- After the Driver submits, an Admin can fill in a missing time or correct
  one (`set_trip_time`, to the minute, Manila time). It prints instead of
  the tap; the tap stays on record. Clearing it brings back the tap (or the
  blank). Locked once the trip is Done.
- **A trip can't be marked Done until every TIME OUT and TIME IN is there**,
  tapped or filled in (`trip_times_missing`). The Driver is never blocked:
  Complete trip doesn't need the stop taps. "Mark clean trips done" skips
  trips with a time missing. A time nobody recorded prints blank.

The on-the-road rules (`apply_changes_on_road` 0060/0063/0064, `report_stop`
0061, `release_missed_stop` 0063, `answer_stop_report` 0068; owner's calls
2026-10-16):

- **Changing a trip on the road still needs the Admin.** Once Start trip is
  tapped (or a Company trip's run has begun), the Scheduler's changes are a
  draft as usual and the Driver keeps the approved route until the Admin
  approves them. Approval then writes the changes onto the version the
  Driver follows, in place, so legs keep their ids and their taps; the
  Driver sees "Route changed" and gets TRIP_CHANGED.
- A reached leg (tapped, or reported missed) and every leg before it must
  come through unchanged, and the vehicle and Driver can't change;
  approval refuses otherwise. On Scheduling, legs after the last one
  reached stay editable.
- **Reporting a stop**: whoever records the trip (the Driver on a Daily
  trip, the requester on a Company trip, or an Admin) can report the
  current stop after Start trip and before End trip: Not available, Wrong
  address / closed, Road blocked / weather, Vehicle problem, or Other.
  Schedulers and Admins get STOP_REPORTED. A report is a problem report
  tied to a leg, so it shows wherever problems do.
- **Every report holds the trip until it's answered** (0068, owner's call
  2026-10-16): no Arrived / Leaving (`schedules.paused_at`) while any
  report on the trip waits; End trip still works, and closes the reports
  still waiting. A Scheduler or Admin answers on Scheduling, and the
  reporter gets STOP_ANSWERED:
  - **Skip it, go to next**: the stop is **missed** (then planned again,
    moved or sent back, below), and its requesters get STOP_MISSED (not
    whoever reported it).
  - **Wait there**: the stop is kept; the Driver goes on when it's ready
    (for a Vehicle problem, once it's fixed).
  - **End the trip**: the Driver taps End trip now; the stops left are not
    reached (below).
  - **Change the route**: the trip stays held until the Admin approves the
    Scheduler's change; until then another answer can still be given.
  A stop isn't missed until the answer is Skip. Nothing is missed or
  decided by the reporter alone.
- **Some of the requests at a stop** (0067): where several requests share
  a stop, Not available or Wrong address can name some of them
  (`problem_reports.request_ids`). If the answer is Skip, the stop is
  still reached (not missed; the Driver taps Arrived / Leaving as usual),
  only those requesters are told, and the Scheduler plans just those
  again. Naming all of them is the whole stop. Other kinds are always for
  the whole stop.
- **Stops not reached** (0066): End trip (in practice "End trip now")
  reports every non-final leg after the last one reached (tapped or
  reported missed) as missed, kind NOT_REACHED. A leg before one reached
  is a forgotten tap, not a missed stop, and still needs the Admin's time.
  A fuel / errand stop is handled at once; one with requests shows on
  Scheduling like any missed stop. Its requesters get STOP_MISSED, and
  Schedulers and Admins one STOP_REPORTED naming the stops.
- A missed stop needs no Arrived / Leaving: `trip_times_missing` leaves out
  its Time In and the next leg's Time Out, and a Company trip may pass it in
  route order. One missed report per stop.
- **Missed stops on Scheduling**: a Scheduler (or Admin) takes a missed
  stop's requests off the trip, and off any draft changes to it, without
  Admin approval, since the route the Driver drives doesn't change. The
  missed leg stays on the route and the printed form, with no stops. The
  banner offers **Plan again** (the requests wait on their day),
  **Another day** (moved to the day picked) or **Send back to requester**.
  Reports from before 0068 that need no planning have **Got it**, which
  marks them handled; Schedulers may handle stop reports. A report not
  handled on its day stays on today's Scheduling, with its day.
- **Missed or past due** (0065): a stop taken off a trip as missed
  (`requests.missed_at`), or one still waiting after its day passed, may be
  moved by a Scheduler to any day from today, Sundays included, whatever
  its flexibility; the requester gets REQUEST_MOVED saying why. Scheduling
  lists these stops on every other day, and adding one to a trip moves it
  to that day. Other stops keep the "any day that week" rule.

## Booking options

- Only an Admin may create or edit Projects, Destinations or Purposes, or
  the lists added for the new forms (0051): Urgent reasons, Starting
  points, Suppliers, Immediate Supervisors and PM / CM / Dept. Heads
  (Departments / Sites too, but it's hidden since 0058).
- Inactive options remain visible on existing requests but must not be
  offered when creating a *new* one (an edit may keep an option the request
  already had).
- Nothing in this group is ever hard-deleted.
- A Destination may have a saved location (coordinates or a Google Maps
  link, pasted on Request choices), used only to check stop taps there.
  Clearing it deletes the `destination_locations` row; the option stays.
  Never add a nullable column to `booking_options` itself (see
  `docs/ARCHITECTURE.md`, `destination_locations`).
- A Destination or Purpose typed under "Other" on a request becomes a choice
  when the request is saved (0049, owner's call 2026-10-09): a name matching
  an Active choice (ignoring case and extra spaces) uses that choice; a new
  name is added as Active and used. A name matching only an Inactive choice
  stays typed. Done inside `insert_request_destinations`, since Requesters
  can't write choices themselves. Project / Site "Other" is unchanged.

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
- **Phone notifications** (0069–0071) repeat the bell: every notification
  goes to each of the recipient's devices that turned them on, and nothing
  else is ever pushed. Any role may turn them on, per device. A device
  belongs to whoever turned it on there last. Signing out pauses it;
  signing back in as the same account sends the unread notifications from
  while it was paused, from the last 24 hours (up to 3, else one "You have
  N new notifications"); signing in as another account moves the device
  without catching up. Inactive accounts get no pushes. A push never
  delays or fails the action behind it.

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
- Emailed links store only a hash of their token, and are built from
  `APP_URL`, never from the request's Host header (`lib/mailer.ts`).

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
- Releases are numbered v2.N. When a release is merged to `master`, add
  its row to `docs/TASKS.md`'s Releases table (date, what, PRs,
  migrations) and tag that merge commit `v2.N`.

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

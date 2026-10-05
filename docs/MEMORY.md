# KOVA — Decision Log

A record of decisions made while building the backend that aren't obvious
from reading the code alone, so future work doesn't accidentally relitigate
or contradict them. Append to this file as new non-obvious decisions get
made; don't remove old entries even if later superseded — note the
supersession instead.

**Older history is in [`docs/archive/MEMORY-history.md`](archive/MEMORY-history.md):**
v1 code decisions (vehicle records, booking RPCs), the 0006–0009 production
rollout and its `migration repair` case, "No live production data exists yet",
the v2.0 plan, the Phase 3–11 design decisions and gotchas, and the v2.0/v2.1
release notes. Search there before re-deciding anything about the v2 schema.
This file keeps what still shapes new work.

## Fresh Supabase projects may need explicit GRANTs alongside RLS policies

Wiring this project up to a real (freshly created) Supabase project
surfaced a bug that no amount of static checking or unit testing could have
caught: every table access failed with `permission denied for table X`
(Postgres error `42501`), for both `service_role` and `authenticated`,
despite `0001_init.sql`'s RLS policies being logically correct. The cause:
**Row Level Security policies only ever narrow what a query can see or
touch — Postgres still requires an ordinary `GRANT` on the table before RLS
policies are even evaluated.** Supabase's dashboard-created projects
usually come with those grants pre-seeded for `anon`/`authenticated`/
`service_role` on the `public` schema, but this isn't something to rely on
for every project (template changes, project age, or an unusual creation
path can all affect it) — and there is no way to detect the gap short of
actually running a query against a real project. Two follow-up migrations
fix it explicitly rather than assuming it: `0004_service_role_grants.sql`
(`GRANT ALL ... TO service_role`, plus `ALTER DEFAULT PRIVILEGES` so future
tables inherit it) and `0005_authenticated_grants.sql` (grants scoped to
exactly what the `_select`/`_admin_write` RLS policies in `0001_init.sql`
already expect to gate). **Any new migration that adds a table other
migrations need to read or write must also grant the relevant privilege to
`authenticated` and/or `service_role`** — adding an RLS policy alone is not
sufficient, and the failure mode (a generic "permission denied") looks
identical to a missing or wrong RLS policy, which is what makes this easy
to misdiagnose.

## Auth identity: synthetic email per username

Supabase Auth requires an email for password sign-in, but KOVA's `accounts`
table (and the whole product) is username-based, with no email column. It
was tempting to add an `email` column instead, but that would introduce a
second identity the app doesn't actually need. Decision: every account's
Supabase Auth email is derived as `<username>@accounts.kova.internal`
(`lib/supabase/accounts.ts`, `usernameToAuthEmail`). This is invisible to
users and to the rest of the app — usernames stay the one identity that
matters. **Any code that creates or renames an Auth user must use this
helper**, never construct the email inline, or the two will drift.

## Vehicle plate rename needs its own RPC

Renaming a vehicle isn't a simple `UPDATE vehicles SET plate = ...` because
`bookings.plate` (and by extension `booking_slots.plate`,
`vehicle_records.plate`) reference it without `ON UPDATE CASCADE`, and the
product requires the old plate to keep resolving via `vehicle_aliases` for
historical records. A multi-statement client-side sequence could leave
these tables inconsistent if interrupted partway. Decision: added
`rename_vehicle` as a new `security definer` RPC
(`supabase/migrations/0003_vehicle_rename.sql`), following the exact same
pattern as the booking RPCs added in the previous migration, rather than
trying to force the rename through RLS-scoped direct table writes.

## Phase 2 security/perf hardening pass (2026-09-21)

A repo-wide audit (see `docs/TASKS.md`) surfaced and this pass fixed:

- **`PUT /api/records/:recordId` didn't verify a Driver's request `date`/
  `plate` matched the linked booking's actual `date`/`plate`** — only that
  `bookingId` referenced one of the Driver's own bookings. A Driver could
  therefore plant a fabricated `vehicle_records` row (including a forged
  `SUBMITTED FOR REVIEW` state) for a vehicle/day unrelated to any real
  trip. Fixed by adding `matchesBookingKey()` (`lib/supabase/records.ts`)
  and calling it before any write in the Driver branch.
- **`GET /api/bootstrap` never checked the `error` half of any of its six
  parallel Supabase queries** — a failing query silently rendered as empty
  data (e.g. "0 vehicles") instead of a visible error. Fixed by checking
  all six results before responding.
- **`is_admin()` was never revoked from `PUBLIC`**, so any authenticated
  user could call it directly (not just via RLS policy evaluation) to
  probe whether an arbitrary uuid belonged to an active Admin. Revoked
  from `PUBLIC`, granted only to `authenticated` (still required for RLS
  policies that call it, since policy evaluation checks the querying
  role's own `EXECUTE` privilege regardless of the callee being
  `security definer`).
- **Every `security definer` function used `search_path = public`**, which
  was already safe against the classic mutable-search-path hijack (it was
  fixed, not mutable) but not the stricter recommended form. All five
  (`is_admin`, `create_booking`, `update_booking`, `cancel_booking`,
  `rename_vehicle`) now use `search_path = ''` with every table reference
  schema-qualified as `public.<table>` — see `0006_harden_definer_functions.sql`.
- **RLS policies weren't split per-operation and called `auth.uid()`/
  `auth.role()` unwrapped**, re-evaluating per row instead of once per
  statement. `0007_rls_policies_per_operation.sql` splits every `for all`
  admin-write policy into explicit insert/update/delete policies (same
  predicates, so this is semantics-preserving, not a permission change)
  and wraps every auth function call as `(select auth.uid())`.
- **No indexes existed on any foreign-key or RLS-filtered column**
  (`bookings.driver_id`/`requested_by_account_id`/`created_by_account_id`/
  `plate`, `booking_slots.booking_id`, `people.account_id`,
  `vehicle_aliases.new_plate`, and the `(data->>'bookingId')::uuid`
  expression on `vehicle_records`) — added in
  `0008_indexes_for_rls_and_fks.sql`.

**None of migrations 0006–0009 change any table's columns**, so no
generated-types regeneration was needed (this repo hand-writes its
Supabase row types in `lib/supabase/mappers.ts`/route files rather than
using `supabase gen types typescript`, and that remains unaffected).

## Docs vs. code as source of truth

`BACKEND_INTEGRATION.md` (repo root) was written *before* any backend code,
as the contract the frontend adapter (`lib/kova-api.ts`) was built against.
It remains the primary contract reference. `docs/ARCHITECTURE.md`'s API
table (moved there from `docs/DESIGN.md` during the Phase 3 docs pass — see
below) is a derived summary pointing at the implementing route files — if
the two ever disagree, treat that as a bug to fix, not a reason to trust
one over the other blindly; check which one the frontend actually relies
on.

## Content-Security-Policy: static header, not proxy-based nonces (2026-09-22)

`next.config.ts` previously shipped without a CSP header at all, deferred
pending verification. Next 16's own docs (`node_modules/next/dist/docs/
01-app/02-guides/content-security-policy.md`) offer two approaches: a
per-request nonce generated in `proxy.ts` (this version's renamed
`middleware.ts`), or a static header set directly in `next.config.ts`.
Nonces require every page to opt into dynamic rendering (`await
connection()`), which this app doesn't currently need — no page reads
`cookies()`/`headers()`, `/` prerenders as fully static, and there are no
third-party scripts to gate behind a nonce. Decision: use the static
header instead, with `'unsafe-inline'` on `script-src` (Next's hydration
payload script) and `style-src` (a handful of `style={{...}}` inline
styles in `app/`/`components/`) — every other directive is locked to
`'self'`/`'none'` (`object-src 'none'`, `base-uri 'self'`, `form-action
'self'`, `frame-ancestors 'none'`, `frame-ancestors` blocking clickjacking
in particular). `connect-src 'self'` is sufficient because this app has no
direct browser-to-Supabase calls — every data operation goes through this
app's own `/api/*` routes. Verified safe by running a real `next dev`
build and loading the sign-in page in headless Chromium: zero
CSP-violation console messages, and inline styles/hydration rendered
correctly. **If a future change adds a client-side Supabase call, a
third-party script, or an inline `<script>` tag with dynamic content,
re-verify the CSP against a running browser** — the static policy assumes
none of those exist today.

## v2.2 closed out (2026-09-29)

`docs/TASKS.md`'s v2.2 section had gone stale: every feature branch it
listed as "code complete, not yet merged" (planner-request-pool,
admin-role-override, notifications, topbar-declutter,
route-based-navigation, other-destination-purpose, return-tank-confirmation,
plus `fix/session-loop-and-logo`) had in fact already merged to `master` via
PRs #49–#56 between 2026-09-28 and 2026-09-29 — confirmed against
`git branch -r --merged origin/master` and `gh pr list --state merged`
rather than trusting the doc. Corrected in place rather than left to drift
further.

**"Today view / Copy for chat"**, the last item in v2.2's originally agreed
scope order, was dropped by the owner 2026-09-29 before any work started on
it. Not deferred to a later version — out of scope entirely unless
re-requested.

No `v2.2` git tag exists yet (`v2.0` and `v2.1` do). Tagging the release is
a separate step, not yet done as of this entry.

## Open questions

- **`docs/PRD.md` acceptance criteria and success metrics are drafts.**
  The criteria restate what the code already enforces; the metrics name what
  to measure from existing timestamps but leave every target blank. Both
  need stakeholder review, and targets should come from the pilot week's
  baseline, not be invented.

## Stacked PR merge order (2026-09-25)

- **Merge a stack top-down, deepest child first.** #32 (`feat/v2-approval` →
  `feat/v2-scheduling`) was squash-merged 18 seconds before #33
  (`feat/v2-cancellation` → `feat/v2-approval`), and #31 (Phase 8) landed on
  `feat/v2-cancellation` after that. Phases 7 and 8 were left on branches
  that no open PR fed into the chain, and Phases 9 and 9b were stacked on
  top of them.
- **Squash merges make later merges conflict.** The same change exists under
  new commits, so a plain merge of the child into the parent conflicts in
  files both touched (docs, `page.tsx`, `kova-api.ts`, `schedules.tsx`).
  The fix used here: merge `origin/feat/v2-scheduling` into a sync branch
  (`chore/v2-sync-scheduling`) built on the stack head, resolve once, and open
  one PR into `feat/v2-scheduling`. Every conflicting hunk was the older
  placeholder against the complete text, so the resolved tree is identical to
  the stack head.
- **Before opening a stacked PR, check that its base is still open**
  (`gh pr list --state all`) and that the parent's PR has not already merged.

## v2.2 Planner: request-pool rewrite (2026-09-28)

- **The request pool went from an input to a status display.** Previously
  the Scheduler ticked which requests to include, then separately built
  each leg and ticked which stop it served. Now ticking is gone entirely:
  the pool just shows what's done/waiting, and legs are built by picking a
  destination via "Add stop" (`lib/trip-record.ts`'s `addPoolLeg`), which
  pulls in every matching unplaced stop automatically. `requestIds` is no
  longer state — it's derived each render from which stops are on a leg
  (`servedRequestIds`), which also simplified opening an existing draft for
  edit (no separate sync step needed).
- **A stop-less leg needed a real database rule, not just a UI one.**
  Before this pass, "Add leg" let a Scheduler pick any Active destination
  regardless of whether a request needed it; a client bug or a direct API
  call could always do the same. `write_revision_content` now rejects a
  non-final leg with zero request stops unless its destination has the new
  `booking_options.is_other_stop` flag, so the fuel/errand-stop escape
  hatch is real and audited, not just a client convention.
- **Leg times are optional to save a draft, required to submit.** This
  needed `schedule_legs.planned_time_out`/`planned_time_in` to become
  nullable (they were `not null` with a `check (planned_time_in >
  planned_time_out)` — that check already tolerates nulls on either side,
  so only the `not null` constraints needed dropping, plus a new
  `check ((planned_time_out is null) = (planned_time_in is null))` so a leg
  can't have just one of the two). `write_revision_content` only records a
  `schedule_reservations` row once every leg in the revision is fully
  timed; `assert_revision_complete` (called by `submit_schedule`) is where
  missing times now actually block progress.
- **pgTAP test gotcha:** a temp table created with `create temp table`
  inside a test file needs an explicit `grant select, insert on <table> to
  authenticated` before a function running `act_as()`'d as a test account
  can read or write it — easy to forget when copying a fixture pattern from
  a test file that never switches role before touching its temp id table.

## v2.2 Admin role override (2026-09-28)

- **"View as Scheduler/Driver" is not impersonation.** Admin's own account
  gains the ability to perform Scheduler/Driver writes, attributed to
  Admin — never to a real Scheduler/Driver account. `driver_id` on an
  Admin-submitted `trip_completions`/`problem_reports` row is Admin's own
  account id, not the schedule's assigned Driver's.
- **No RLS policy changes were needed.** Schedule/completion/problem writes
  were already RPC-only (`0020_v2_revoke_default_grants.sql` revokes
  `insert`/`update`/`delete` from `authenticated` on those tables), so the
  only thing to widen was each RPC's internal `v_actor.role` check
  (`0034_admin_role_override.sql`), not a `for insert`/`for update` policy.
  Likewise no read-path change: Admin already sees every schedule and
  completion (`can_view_schedule`/`trip_completions_select` etc. already
  special-case `role = 'Admin'`), so the Driver "My Schedule" screen just
  needed an optional `driverId: string | null` prop to skip its client-side
  per-driver filter when Admin is viewing as Driver.
- **Audit-event ordering bug caught by the pgTAP suite, not by review:**
  the first draft set `kova.audit_is_override` *after* the `insert into
  schedules` in `save_schedule_draft`'s new-schedule branch, so that row's
  own audit event missed the override flag even though later rows in the
  same call (the revision insert) had it. `write_audit_event()`'s trigger
  fires at each statement, not at function return, so a transaction-local
  `set_config` must be set before the specific statement whose audit row
  needs it, not just "before the function ends." Running `supabase test
  db` against a fresh `supabase db reset` after writing the migration is
  what caught this — the existing schedule/completion pgTAP fixtures also
  assumed the pre-override "Admin cannot create a schedule" behavior, which
  needed updating (not a regression, an intentional contract change) once
  those old assertions started failing.
- pgTAP: 244/244 passing locally (`v2_schedules.test.sql` 56, up from 55;
  `v2_completion.test.sql` 33, up from 27).

## v2.2 In-app notifications (2026-09-28)

- **Not Supabase Realtime, on purpose.** The owner's first choice for live
  updates was Supabase Realtime, but this app's frontend has a standing
  invariant (`docs/ARCHITECTURE.md`): it never talks to Supabase directly
  and never holds a Supabase key — every access goes through KOVA's own API
  routes. True Realtime needs the browser to open a websocket straight to
  Supabase with the anon key and the user's own JWT, which breaks that
  invariant. Resolved by building a Server-Sent-Events route of KOVA's own
  instead (`GET /api/notifications/stream`): it holds the same cookie-scoped
  session client as every other route, polls this account's notifications
  every ~4s, and pushes an event when something's new. `EventSource` doesn't
  need an explicit `withCredentials` flag for this to work, since the route
  is same-origin and cookies are sent by default for same-origin requests.
- **A serverless function can't hold a stream open indefinitely.** The
  stream route closes itself after ~50s (`STREAM_DURATION_MS`), comfortably
  under any Vercel plan's function duration limit (`maxDuration = 60` is set
  explicitly since nothing in this repo set one before). The browser's
  `EventSource` reconnects on its own after a closed stream — no client-side
  reconnect logic was needed.
- **Every notification is written inside the RPC that causes the event**,
  in the same transaction as the change itself (`0035_notifications.sql`
  adds `create or replace function` for `submit_schedule`, `approve_schedule`,
  `return_schedule`, `request_cancellation`, `decline_cancellation`,
  `confirm_cancellation`, `cancel_schedule`, `report_problem`). This was a
  deliberate choice over writing notifications from the Next.js API routes
  after the RPC call succeeds, matching the existing audit-event pattern in
  this app: it can't be lost or duplicated relative to the event, and can't
  drift if a route forgets to call it.
- **`confirm_cancellation`'s cascade needed care to notify the right people
  with the right type.** When cancelling the one request that was the only
  live request left in a schedule, `cancel_schedule_row` is called
  internally and releases every other still-active request back to
  `NOT_YET_SCHEDULED` — except any of those that *also* had their own
  pending cancellation, which get cancelled instead. The notification logic
  captures the other active request ids **before** that cascade runs, then
  after it checks each one's resulting status: `CANCELLED` gets
  `REQUEST_CANCELLED`, still-`ACTIVE` gets `REQUEST_RETURNED`. Getting this
  right needed a dedicated pgTAP scenario (two Requesters sharing a stop,
  one cancelling first without triggering the cascade, confirmed by
  `v2_notifications.test.sql`).
- Client never holds an insert/update grant on `notifications`: reads go
  through RLS (`account_id = auth.uid()`), and `read_at` is only ever set by
  `mark_notification_read`/`mark_all_notifications_read`, both
  `security definer` RPCs.
- pgTAP: 270/270 passing locally (`v2_notifications.test.sql`, new, 26
  checks; 244 pre-existing unaffected).
- Verified end-to-end in a real, running dev server against local Supabase
  (headless Chromium): inserted a notification directly via the
  service-role client (standing in for what an RPC does mid-transaction)
  while signed in as a seeded Requester, confirmed the badge and panel
  picked it up live within one poll interval with no manual refresh,
  and that marking one read / "Mark all read" both cleared correctly with
  zero browser console errors. Backend correctness per RPC (who gets
  notified, with what type) is covered by pgTAP rather than re-walked by
  hand in the browser.

## Problem reports on unsubmitted trips (2026-10-01)

- **A problem report doesn't imply a completion.** Drivers (and Admin) may
  report a problem on an active trip before submitting it, so any screen or
  count over problem reports must not assume the trip is finished. Admin
  Finished Trips uses `buildAdminTrips`, whose `completion` is nullable;
  `buildFinishedTrips` (Driver screen, print form) still only returns
  trips with a completion.

## Request pool: Urgent first, send back (2026-10-02)

- **Unplaced requests go back to the requester, not into limbo.** Before
  this, a request that didn't fit stayed "Not yet scheduled" on a date that
  would pass, and the requester was never told. The Scheduler now sends it
  back (`send_back_requests`, migration 0038), and the requester re-dates
  or cancels it. Decided with the owner: manual per request plus a bulk
  "Send back all unplaced", not automatic, since there's no reliable
  "planning is finished for this day" moment to trigger on.
- **"Sent back", not "Returned".** `RETURNED` already means an Admin
  returned a *schedule* to the Scheduler (and `REQUEST_RETURNED` is a
  cancelled schedule releasing its requests), so the new request state is
  `SENT_BACK` / `REQUEST_SENT_BACK` to keep the two apart.
- **Sent back is stored, unlike the rest of `request_progress`.** It's a
  decision, not a consequence of schedule rows, so it lives on `requests`
  (`sent_back_at`/`_by_account_id`/`_reason`). Two triggers keep it honest
  without new copies of `update_request` or `write_revision_content`: a
  date change clears it, and `schedule_requests` refuses an inclusion of a
  sent-back request. Editing without changing the date keeps it sent back.
- **Urgent priority is guidance, not a rule.** The pool sorts Urgent first
  and submit warns about an unplaced Urgent request, but nothing blocks
  submitting without it: it may belong on another vehicle's schedule.
- **Regular's 7-day notice still applies when re-dating** a sent-back
  request, so a requester moving it to a date under 7 days out has to
  switch it to Urgent.
- **Submit only needs the stops of requests the route serves.** The planner
  used to pass every pool stop for the day to `tripProblems`, so a schedule
  couldn't be submitted until every request that day was on it — wrong once
  requests can go on another vehicle or be sent back. `missingStops` now
  matches `assert_revision_complete`: a request is served once any of its
  stops is on a leg, and then all of its stops must be. A half-placed
  request no longer blocks submit either: see "split on submit" below.
- **Submitting can send back the leftovers.** The submit dialog lists pool
  requests with no stop on the route, with "Send these back" ticked by
  default (the owner's call). It stays optional because a day may need a
  second vehicle. The send-back runs after `submit_schedule` as a separate
  call; if it fails, the schedule is still submitted, the notice says so,
  and the requests stay in the pool.
- **A request's stops can go on different cars by splitting, not by
  sharing.** The owner wanted a request's stops spread across vehicles. The
  whole model is one request = one trip on one schedule (unique active
  `schedule_requests` per request; progress, cancellation and completion
  all look up "the" schedule), so instead of letting a request span
  schedules, submit splits a half-placed request (`split_request`, migration
  0039): the stops on the route stay, the rest move into a new request with
  the same requester, date, type and project. The new request is a normal
  leftover: sent back with the others, or kept in the pool for another car.
  The moved destinations are copied and the originals marked inactive, like
  an edit, because past revisions' leg stops may reference them. The split
  runs after saving the draft and before `submit_schedule`, so a failed
  split submits nothing; a split followed by a failed submit leaves the new
  request in the pool. The requester gets a `REQUEST_SPLIT` notification.

## Urgent window (2026-10-02)

- **Urgent is today up to 6 days ahead; Regular is 7+.** The owner wanted
  any date before the 7-day Regular notice to be bookable as Urgent, so the
  old 2–6 day gap is gone and the date alone decides the type. Today still
  counts as Urgent. Migration 0040 numbered after PR #62's 0038/0039 so the
  two can merge in either order.

## Request type set from the date (2026-10-02)

- **The API sets the type; the Requester no longer picks it.** Since 0040
  every date fits exactly one type, so the picker was pure friction. The
  request routes call `requestTypeFor(date)` (`lib/timezone.ts`) and ignore
  any `requestType` in the body; `check_request_date` still rejects a
  mismatch, so no migration was needed.
- **An edit keeps the type unless the date changes**, so adding a stop to a
  Regular request 3 days before its day doesn't turn it Urgent.
- **An Admin's past-date request is Regular.** It's a trip someone forgot to
  log, not an urgent ask, and Urgent would put it first in the planner pool.

## Bulk "Mark clean trips done" (2026-10-02)

- **Clean = submitted and no open problem report.** No distance check: the
  owner chose that over reusing the 500 km warning. The confirmation lists
  each trip's distance so an odd one can be spotted before confirming.
- **It only closes what the filters show**, so the Admin can scope it to a
  week, Driver or vehicle. Trips the Driver hasn't submitted are never
  included.
- **No new endpoint or migration.** The client calls the existing
  `POST /api/schedules/:id/completion/done` once per trip
  (`markCompletionsDone`): each is its own atomic change, repeating one is
  safe, and a failure on one doesn't stop the rest. It reloads once at the
  end. The dialog reports "N marked done, M couldn't be" on a partial failure.

## Startup data window (2026-10-02)

- **Why a window:** `GET /api/bootstrap` returned every request, schedule and
  completion ever made, and `request_progress` ran a function per request.
  Both grow with every trip.
- **Unfinished work is never hidden by age.** A trip submitted but not closed,
  an open problem and a pending cancellation always load, with their
  schedules and requests, so counts on Admin Home stay right.
- **Not windowed:** accounts, vehicles, booking options, notifications (last
  50). An old *unscheduled* past-dated request outside the window is not
  loaded until "Load older records"; that was judged acceptable.
- **`since` is validated** (`parseSince`); a bad value falls back to the
  default instead of erroring.

## E2E test setup (2026-10-05)

- **Setup goes through the API, the step under test through the UI.**
  `publishTrip` (`e2e/helpers.ts`) files a request and has admin1 save,
  submit and approve a schedule on UAT-001, driver1's vehicle. Only the
  request → approval test drives the planner.
- **Trip-record tests use a past date owned by admin1.** A trip can't be
  recorded before its last Time In, and only an Admin may request a past
  date. Keep it within the 90-day startup window or the Driver won't see it.
- **Random day and hour, retried on a clash**, so reruns against a local
  database full of old test trips don't collide on UAT-001.
- **`next dev` can 404 an API route the first time it compiles it.** A local
  run can fail once that way; rerun. CI tests a production build, so it
  doesn't see this.

## UI refresh (2026-10-05)

- **Colors come from the Kayelen's Construction logo.** Primary is the
  logo blue `#2b47a8` (replacing `#2357d9`), with navy for dark surfaces.
  Status colors are tokens (`--success`, `--warning`, `--error`, `--info`,
  `--neutral`, each with `-bg`, `-border`, `-fg`); use them rather than
  typing hex values. Decided with the owner.
- **Sidebar instead of home-button navigation**, chosen by the owner over
  restyling the old top bar. The dashboard keeps its quick-action cards.
- **Turbopack can keep serving stale `globals.css`**, even across a dev
  server restart, in a second git worktree on Windows. If a CSS change
  doesn't show, stop the server, delete `.next` and start it again.
- **Stale CSS in production (2026-10-05).** The #84 deploy shipped the new
  markup with the old `globals.css`: Turbopack's filesystem build cache (on
  by default since Next 16.3) was restored by Vercel and reused. Fixed by a
  Redeploy without build cache, then #85 turned the cache off for build and
  dev in `next.config.ts`. If styles ever look old after a deploy, compare
  the served stylesheet with a clean local build first.

## Done trips and Scheduler Finished Trips (2026-10-05)

- **A trip leaves Schedules / My Schedule when the Admin marks it Done**,
  not when the Driver submits; "Waiting for review" trips stay. Owner's call.
- **No migration for Scheduler access.** The owner asked to avoid one, so
  Schedulers get finished trips from request progress (`request_progress_of`
  is security definer and reads the completion) instead of a wider
  `trip_completions` policy. The trade-off: no odometer or distance for them.

## Dashboard tile filters (2026-10-05)

- **A status link opens Schedules on All dates**, not the current week:
  tile counts span every date, so a week-bound list could show fewer than
  the tile said. Agreed with the owner. Filter links are read once and
  stripped from the URL, like `?notice=` and `?open=`.
- **"Trips today" opens the Day view unfiltered.** The tile counts only
  published trips, while the Day view also shows that day's drafts; there
  is no single status filter that matches it.

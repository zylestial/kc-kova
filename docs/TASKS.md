# KOVA — Task Status

Kept as a living checklist of what's implemented vs. outstanding. Update
this file whenever a task's status changes.

## Status: v2.1 live (2026-09-25)

v2.0 was released to production on 2026-09-25 (see "v2.0" below), and
v2.1, a UX pass on top of it, followed the same day (see "v2.1" below).
The v1.0 notes that follow are kept as history.

All planned v1.0 functionality is implemented and verified: `tsc --noEmit`,
`eslint`, `vitest`, and `next build` all pass clean; the app has been
exercised end to end against the live `kc-kova` Supabase project (API,
RLS, and RPC layers) and walked in a real browser. The app is deployed via
Vercel and is now in UAT — see `docs/QA_ROLE_TESTS.md` for the test plan
and its seeded accounts, kept current via `scripts/seed-uat.mjs`. Items
under "Outstanding / follow-ups" below are tracked technical debt and
post-v1.0 hardening, not blockers to this milestone.

## Done

- [x] Postgres schema + RLS policies for all core tables (`0001_init.sql`)
- [x] Atomic booking create/update/cancel via RPC (`0002_booking_functions.sql`)
- [x] Atomic vehicle plate rename via RPC (`0003_vehicle_rename.sql`)
- [x] `POST /api/auth/sign-in` — username/password sign-in, rate-limited
- [x] `GET /api/auth/session` — restore session on load
- [x] `POST /api/auth/sign-out`
- [x] `GET /api/bootstrap` — role-scoped hydration via RLS
- [x] `POST /api/accounts`, `PUT /api/accounts/:id`, `POST /api/accounts/:id/password`
- [x] `POST /api/vehicles`, `PUT /api/vehicles/:plate`
- [x] `POST /api/bookings`, `PUT /api/bookings/:id`, `DELETE /api/bookings/:id`
- [x] `PUT /api/records/:recordId` — submission validation, Admin review, history
- [x] `PUT /api/booking-options/:group/:id`, `PUT /api/booking-options/people/:id`
- [x] `tsc --noEmit`, `eslint`, and `next build` all pass on every route added
- [x] Vitest unit tests for the pure business-rule/mapping helpers: ANONANG
      round-trip check, odometer/time-eligibility validation, history
      diffing, admin-only field stripping, auth-email mapping, and every
      DB-row-to-API-type mapper (`lib/supabase/records.test.ts`,
      `accounts.test.ts`, `mappers.test.ts`, `lib/kova-api.test.ts`) — run
      with `pnpm test`
- [x] Fixed 9 pre-existing lint errors in the original frontend scaffold
      (`booking-flow.tsx`, `booking-options.tsx`, `driver-trips.tsx`,
      `scheduler.tsx`, `settings.tsx`): render-time hydration moved to lazy
      `useState` initializers, two genuinely prop-reactive state syncs in
      `scheduler.tsx` deferred to a microtask so the setState call isn't
      direct-in-effect, an impure `Date.now()` call during render replaced
      by a lazy-initialized clock tick, and one `any` replaced with a
      generic in the record field updater. `eslint .` is now error-clean
      (one unrelated `<img>` warning remains).
- [x] GitHub Actions CI (`.github/workflows/ci.yml`): runs
      `tsc --noEmit`, `eslint`, `vitest run`, and `next build` on every
      push and pull request.
- [x] Repo pushed to GitHub as `zylestial/kc-kova` (private), CI verified
      green there.
- [x] **Exercised end to end against a live Supabase project.** Every route
      was hit with real HTTP requests against a running `next dev` server
      wired to a real project: sign-in/session/sign-out, role-scoped
      bootstrap, vehicle create + rename (with cascading plate updates onto
      existing bookings), account creation, booking create with conflict
      rejection (409 on overlap) and cancel (which correctly freed the slot
      for rebooking), and the full record lifecycle — submission blocked
      before the scheduled end time, blocked for a non-ANONANG round trip,
      accepted with server-set `submittedAt`, locked against further Driver
      edits, Admin edit producing a correct history diff, mark-done
      producing a `MARK AS DONE` history entry, and locked again after
      `DONE`. All test data created during this pass was cleaned up
      afterward. Two real bugs were found and fixed this way (see
      `docs/MEMORY.md`): `service_role` and `authenticated` both lacked the
      ordinary Postgres table GRANTs that RLS policies depend on — a fresh
      Supabase project doesn't pre-seed those the way older/dashboard-
      created projects sometimes do, so every table access failed with
      `permission denied` despite the RLS policies themselves being
      correct. Neither gap could have been caught by `tsc`, `eslint`, unit
      tests, or `next build` — only a real request against a real database
      surfaced them.
- [x] **Walked the actual UI in a browser against the live Supabase
      project** (headless Chromium via Playwright, driven ad hoc — not a
      committed test): signed in as the seeded `admin` account, landed on
      Admin Home, navigated into the Schedule/booking-flow screen (which
      correctly showed "0 vehicle-hours open" against the now-empty
      project) and into Settings → Accounts (which correctly listed the
      real seeded account). Zero browser console errors across all three
      screens. This confirms `lib/kova-api.ts`'s fetch layer and the
      screens built on it work end to end against the real backend, not
      just the API in isolation.

- [x] **Phase 2 audit fix-up (2026-09-21)**: fixed the `vehicle_records`
      date/plate spoofing gap, unchecked `bootstrap` query errors, the
      `is_admin()` PUBLIC-execute grant, `search_path` on every
      `security definer` function, split RLS policies per-operation with
      cached `auth.uid()`/`auth.role()`, added FK/RLS-column indexes,
      added env-var validation at startup (`instrumentation.ts` +
      `lib/env.ts`), added baseline (non-CSP) security response headers,
      and closed 4 dependency advisories in next's build-time toolchain
      via `pnpm-workspace.yaml` overrides. See `docs/MEMORY.md` for the
      full list and rationale, and the open items below for what this
      pass explicitly deferred.
- [x] **Migrations 0006–0009 verified against a local `supabase start`
      instance** and a manual RLS regression pass (anon isolation, Driver
      ownership isolation, Admin full access, all four RPCs end-to-end).
      Found and fixed two real bugs that code review alone had missed —
      an `anon` execute grant on every RPC that `revoke ... from public`
      never touched, and a `search_path=''` regression that broke two
      `0001_init.sql` triggers when actually invoked. See `docs/MEMORY.md`
      for the full account. `supabase/config.toml` is now committed so
      this is repeatable for anyone with Docker.
- [x] **Migrations 0006–0009 applied to production** (`kc-kova`,
      ref `rhzqdtgruhpdhopkksuf`) via `supabase db push`, after a manual
      schema+data backup and confirming production's `vehicle_records` had
      no rows that would break `0008`'s expression index (it was in fact
      completely empty except the seeded Admin account, so the concern
      raised below didn't materialize). Verified post-push with a
      read-only schema dump: all 22 expected per-operation RLS policies
      and all 8 expected indexes present. PR #1 (`chore/audit-and-cleanup`)
      merged to `master`.

- [x] **Content-Security-Policy header** (`next.config.ts`) — static
      (non-nonce) policy locked to `'self'`/`'none'` on every directive
      except `script-src`/`style-src` (`'unsafe-inline'`, required by
      Next's hydration script and this app's inline `style={{...}}` usage).
      Verified against a real `next dev` build in headless Chromium: the
      sign-in page rendered correctly with zero CSP-violation console
      messages. See `docs/MEMORY.md` for why the static approach was chosen
      over proxy-based nonces.

## Outstanding / follow-ups

- [ ] **Zod (or similar) boundary validation was not rolled out to every
      API route** — most routes already do manual `typeof body?.x ===
      "string"` checks, which are correct but inconsistent in shape and
      easy to get subtly wrong on a new route. `zod` is already a
      dependency (via `@hookform/resolvers`); worth a dedicated pass to
      define one schema per route body and parse with it up front, rather
      than mixing this into an unrelated fix.
- [x] **pgTAP / integration tests proving RLS isolation** — committed as
      `supabase/tests/*.test.sql` in v2 and run by CI on every PR since
      v2.5 (see below).
- [x] **`vehicle_records` writes run through application code + the
      service-role client, not a Postgres RPC** (obsolete: the table and
      route were removed in Phase 9b) (see
      `docs/ARCHITECTURE.md`), unlike every other write path in this app.
      This was a deliberate scope trade-off for this pass, not an oversight.
      Consider porting `app/api/records/[recordId]/route.ts`'s logic into a
      `security definer` RPC (mirroring `create_booking`) for the same
      atomicity guarantee bookings get, especially the read-modify-write
      history diff, which has a narrow race window under concurrent writes
      to the same record.
- [ ] **Password policy** is currently just "8+ characters" — revisit if the
      organization has stronger requirements.
- [ ] **Rate limiting** only covers sign-in. If abuse becomes a concern on
      other write endpoints (e.g. account/vehicle creation), the same
      `login_attempts`-style pattern could be extended.
- [ ] **`docs/PRD.md`, `RULES.md`, `DESIGN.md`** were written by
      reverse-engineering `BACKEND_INTEGRATION.md`, the schema, and the
      existing frontend components — they have not been reviewed against
      what the actual stakeholders (KOVA's operators) want. Treat them as a
      first draft to correct, not a finished spec.
- [ ] **`docs/PRD.md` has no Success metrics or Acceptance criteria
      sections.** Not invented here since no stakeholder input or
      analytics exist to source them from — logged as an open question in
      `docs/MEMORY.md`. Fill in once that input exists.
- [ ] **The live-Supabase and UI verification above was manual (curl and an
      ad hoc Playwright script against a running dev server), not
      automated.** Worth turning into a real, committed integration/e2e
      test suite (e.g. against a Supabase local/CI instance) so the
      RLS-grant class of bug and the RPC conflict/atomicity guarantees are
      checked on every change, not just once by hand. Only Admin Home,
      Schedule, and Settings/Accounts were walked — Driver-trip submission,
      Admin review, and Booking Options/Vehicles tabs still haven't been
      clicked through in a real browser.

## Planned — v1.1 (Booking Type + Admin Approval, code-complete 2026-09-22)

Scoped 2026-09-22 while v1.0 is in UAT, refined 2026-09-22 into its own
milestone (previously one bullet among several prospected v1.1 items — see
v1.2 below for the rest of that original list). Supersedes the earlier
"Booking conflict waitlist" bullet: that item only required Admin review
for a *conflicting* booking; this is broader — **every** new booking (or
rescheduled existing one) requires explicit Admin approval before it's
confirmed, not just a conflicting one.

- [x] **Booking Type (Regular/Urgent) + universal Admin approval** — code
      complete on `feat/booking-approval-flow`, not yet merged or UAT'd. A
      required Booking Type on every request: Regular needs 7 Asia/Manila
      calendar days' notice; Urgent is same/next-day only and requires a
      stated reason. Applies to everyone, Admin included, with one
      confirmed exception: an Admin logging a date before today (the
      existing "log an already-elapsed slot" rule) bypasses the deadline
      checks entirely, same as before. Every new request is created
      `PENDING` and holds no `booking_slots`, so it never blocks a slot for
      anyone, including itself; an Admin reviews each one on a new
      "Booking Approvals" screen and either **approves** it (cancelling any
      currently `SCHEDULED` booking(s) that conflict with it, then
      promoting it to `SCHEDULED` and reserving its slots) or **denies** it
      (`REJECTED`, any conflicting booking untouched). Editing an
      already-`SCHEDULED` booking's date/time/vehicle/driver *or* Booking
      Type/Urgent Reason drops it back to `PENDING` and needs re-approval;
      editing only destination/purpose/notes does not.
      `supabase/migrations/0011_booking_type_and_approval.sql` was verified
      by hand against a local `supabase db reset` instance (deadline
      acceptance/rejection for both types, the Admin past-date bypass,
      `approve_booking`'s conflict-cancellation and slot reservation,
      `deny_booking`, non-Admin rejection, and `update_booking`'s
      PENDING-reversion on schedule changes vs. no-reversion on
      destination/purpose/notes-only edits) — one real bug (`FOR UPDATE`
      combined with `DISTINCT` is invalid in Postgres) was found and fixed
      this way. `tsc --noEmit`, `eslint`, `vitest run`, and `next build`
      all pass. **Real-browser click-through completed (2026-09-23)**,
      headless Chromium against the local Supabase instance with the
      seeded UAT accounts: booker flow (date selection, Booking Type
      toggle showing the 7-day-notice warning, switching to Urgent
      revealing the required Urgent Reason field, submitting a request,
      "Your pending requests" panel, My Bookings listing it as `Pending
      Admin approval`), and Admin Booking Approvals (pending-count badge
      on Admin Home, list, detail dialog showing Driver/Destination/
      Purpose/Urgent reason, and Approve — including the confirm-dialog
      warning "This will cancel N currently scheduled booking(s) that
      conflict with it" and the pending row disappearing after approval).
      Zero browser console errors throughout. RLS spot-check also passed:
      signed in as a second Booker (`booker2`) and confirmed neither the
      "Your pending requests" panel nor My Bookings shows the first
      Booker's `PENDING` rows.

## Planned — v1.2 (prospecting only, not started)

**Nothing below is built yet** — this is a prospect list to build from
once UAT feedback comes in; more items will be added after that pass.
Constraints that apply to all of it: keep exactly the three existing roles
(Booker, Driver, Admin) and the existing three-step booking flow (Choose
Date → Vehicle & Time → Booking Details); extend existing components
rather than rebuilding; no Company Trip Form and no Form Type choice —
remove either if found on a working branch; small Add/Edit actions stay
popups; never rely on a hidden button as permission enforcement (every
rule needs a real backend check); no demo accounts or browser-only-
authoritative data.

- [x] **Vehicle → Driver assignment.** Merged to `master` via PR #20
      (`feat/vehicle-driver-assignment`). Selecting
      a Vehicle in booking Step 2 auto-resolves its one current active Driver
      (no separate Driver picker in the normal flow). Admin Settings →
      Vehicles gets an "Assigned Driver" dropdown (active Drivers only) in the
      existing Add/Edit popup, and the Vehicles list shows each Vehicle's
      assigned Driver or "No Driver assigned." One Driver ↔ one Vehicle at a
      time, enforced server-side (`vehicles_assigned_driver_id_unique`
      partial index, a trigger requiring an active Driver, and an
      auto-unassign trigger when a Driver is deactivated — a Vehicle with no
      active Driver isn't bookable, checked by `create_booking`/
      `update_booking` themselves rather than trusting a client-supplied
      Driver). Reassigning a Driver never rewrites already-confirmed
      bookings, since `bookings.driver_id`/`driver_name` are snapshotted at
      create/update time, not read live off the Vehicle's current
      assignment. Edit Booking re-resolves the proposed Driver when the
      Vehicle changes and rechecks availability before saving. Verified
      against a local `supabase db reset` instance and with a real
      end-to-end pass against the running dev server + local Supabase; see
      `docs/MEMORY.md` for two real bugs found and fixed during that
      verification.
- [x] **Finance "Date Submitted" from `submittedAt`.** Backend sets
      `submittedAt` once, authoritatively, on the Driver's successful
      submission — never reset by Admin edits, printing, or Mark as Done,
      and rejected if a client tries to supply/forge it directly. Finance
      displays it read-only, derived from the org's configured business
      timezone (default `Asia/Manila` if none is configured — document
      this default), distinct from the scheduled trip date, Finance
      processing date, and Done date. Carries through to the PDF.
      Historical `submittedAt` values must not be migrated/overwritten.
- [x] **Official logo + KOVA lockup.** Replace the placeholder logo with
      the official company logo (used as-is: no redraw/crop/stretch/
      recolor/substitute) on Sign In, the app header, and compact/mobile
      headers, arranged as `[logo] · KOVA` with "Kayelen's Operations and
      Vehicle Allocation" in smaller text beneath KOVA. Must wrap/scale
      cleanly on narrow screens without colliding with nav or Sign Out,
      and must still print clearly in the Daily Vehicle Record PDF header.
- [x] **Mobile Driver experience.** Audit and fix the full Driver journey
      (Driver Home, My Schedule, Trip Details popup, DVR's Vehicle
      Details/Trip Record+Add Leg/Return steps, Review Trip, Submit Trip,
      Finished Trips, and the read-only submitted view) at ~320/375/430px
      widths: no horizontal scroll or clipped fields, card-based layouts
      where a desktop table would otherwise need sideways scrolling,
      stacked form fields with associated labels, real touch targets for
      Add/Remove Leg and Back/Review/Submit, a usable (even if
      horizontally scrollable) tab row, popup titles/actions that stay
      reachable while content scrolls, and an on-screen keyboard that
      never blocks the active field or the submit action. Desktop layout
      is unaffected.
- [x] **Mobile-responsive Booking Type + Approval flow.** The v1.1 screens
      (Booker Home, the 3-step booking flow including its new Booking Type
      dropdown/Urgent Reason field and "Your pending requests" panel, My
      Bookings, and Admin Booking Approvals) were built and verified on
      desktop widths only. Audit and fix all of them at ~320/375/430px:
      the step-2 time grid and admin/my-bookings tables need a card-based
      or scrollable layout instead of horizontal table scroll, dialogs
      (booking details, edit, approve/deny confirmation) must stay fully
      reachable and scrollable on small screens, and touch targets (date
      strip, Approve/Deny, Cancel) must be real tap targets. Desktop
      layout is unaffected.

- [x] **Booking notes not shown on Admin Booking Approvals** — resolved
      while building the v1.1 approval flow: `app/admin-booking-approvals.tsx`
      pending-request rows are now clickable and open a detail dialog that
      shows Notes (when present), Destination, Purpose, and Urgent Reason,
      mirroring the requester's own booking-detail dialog. No longer an
      open item; kept here (rather than deleted) as a record that this gap
      was found and closed, not overlooked.

Each item above needs its own confirm-before-building pass per this
repo's git workflow (`CLAUDE.md`) once UAT feedback prioritizes it — this
section is scope capture, not a build order.

## v2.0 (phased upgrade, released 2026-09-25)

Full plan adopted 2026-09-24: `KOVA-v2-Claude-Implementation-Plan.md` (repo
root), indexed at `docs/v2/PLAN.md`. Upgrades the **same** repo, Vercel
project and production database in place across four roles (Requester,
Scheduler, Admin, Driver) and 13 phases (0–12); see `docs/v2/PLAN.md` for
the phase table. Each phase requires explicit "May I start Phase N?"
approval before starting — approving the overall plan is not approval for
any individual phase. Phases 0–11 are done and v2.0 is live. Phase 12
(stabilize and hand over) is deferred to a later version.

- [x] Phase 0 — Inspect v1.2 and establish the baseline. See
      `docs/v2/baseline.md`: all reported capabilities verified against
      actual code (booking RPCs, RLS, submission locks, print component);
      `tsc`/`eslint`/`vitest` (62/62)/`next build` all pass clean; no git
      tags exist yet; Vercel project settings unverified (no local CLI/
      dashboard access this session); cleanup inventory found ~46 of 61
      unused vendored shadcn UI components plus 6 backing npm deps; 4
      conflicts flagged for a decision before Phase 3 (existing
      Booker-approval flow vs. the Requester/Scheduler model, Scheduler
      being a new role not a rename, an overlapping open v1.2 backlog
      item, and legacy-data Scheduler attribution).
- [x] Phase 1 — Git protection and development branches. See
      `docs/v2/git-and-release.md`: `v1.2-stable` tag on master's verified
      tip, `v1-maintenance` and `v2-development` branches created and
      pushed, Phase 0 docs merged into `v2-development` via PR #27.
      Feature branches deliberately not pre-created (cut per-phase).
- [x] Phase 2 — Reuse the v1.2 database and Vercel project. See
      `docs/v2/environment-map.md`: confirmed live `kc-kova` Vercel project
      (Next.js preset, no custom domain, git-integrated with
      `master` -> Production / everything else -> Preview), all 12
      existing migrations replay cleanly on a fresh local Docker instance.
      **Preview/Production credential sharing — investigated, then
      deliberately kept (2026-09-24)**: `SUPABASE_SERVICE_ROLE_KEY` and both
      `NEXT_PUBLIC_SUPABASE_*` vars are scoped to both Preview and
      Production. Initially removed from Preview as a fix, then restored
      once you confirmed this Supabase project holds **no real/live data
      yet** (still pre-launch UAT — see `docs/MEMORY.md`) and your plan is
      to keep experimenting against this one shared project through v2
      development, clearing it before the real launch. Current state
      matches the original v1.2 config. **Must be revisited before real
      data/users enter this project**, at the latest by Phase 11. No
      production backup was taken this session (deferred until Phase 3/11
      actually need one).
- [x] Phase 3 — Database model, permissions, state transitions, full
      Requester role migration. See `docs/v2/phase-3-schema.md`, branch
      `feat/v2-foundation`: migrations 0013–0023 (requests, schedules
      with versioned revisions, minute-precision reservations with
      exclusion constraints, completion/problem tables, append-only audit,
      request and schedule RPCs, derived request progress, Booker →
      Requester conversion); pgTAP 72/72 and a two-session concurrency
      script 9/9 on a fresh local reset; app code and docs renamed to
      Requester. **Applied locally only, not to `kc-kova`**: 0023 is
      release-time only. Deferred by design: cancellation RPCs (Phase 7),
      completion/problem RPCs (Phase 8), and v1 `booking_slots` vs. v2
      reservation cross-checks (Phase 10).
- [x] Phase 4 — Requester and Admin request creation. See
      `docs/v2/phase-4-requests.md`, branch `feat/v2-requests` (stacked
      on `feat/v2-foundation`): New request (date only, Regular/Urgent,
      Project / Site or Other, several destinations each with a purpose,
      Review modal) and My requests with derived progress and editing
      until scheduled, for Requester and Admin; `/api/requests` routes;
      migrations 0024 (edits may keep since-deactivated options) and 0025
      (stale edits return 409); `app/my-bookings.tsx` removed. pgTAP
      83/83, concurrency 9/9, vitest 73/73, 22-step browser walkthrough.
      **Local database only.**
  - [x] **Before Phase 5:** the schedule RPCs in 0021 raise SQLSTATE
        `40001` for stale saves, which PostgREST retries forever, so the
        HTTP call hangs. Switch them to `PT409` the way 0025 did for
        `update_request`. Done in Phase 5 (migration 0026).
  - [x] Move `scripts/seed-uat.mjs` from `Booker` to `Requester` when
        0023 is applied to `kc-kova`. Done after the 2026-09-25 release.
- [x] Phase 5 — Scheduler planning and Trip Record. See
      `docs/v2/phase-5-scheduling.md`, branch `feat/v2-scheduling`
      (stacked on `feat/v2-requests`): Create schedule (day, request pool,
      existing commitments, vehicle with its Driver, Trip Record legs with
      manual shared stops, Add leg / Add final leg, Save draft, Submit,
      Discard) and Schedules (Day/Week, date/vehicle/Driver/status
      filters) for Scheduler; `/api/schedules` routes; migrations 0026
      (stale schedule saves return 409) and 0027 (8-leg cap). pgTAP 84/84,
      concurrency 9/9, vitest 101/101, API smoke 29/29, 45-step browser
      walkthrough. **Local database only.**
- [x] Phase 6 — Approval, revisions and publication. See
      `docs/v2/phase-6-approval.md`, branch `feat/v2-approval` (stacked
      on `feat/v2-scheduling`): Admin Schedules with Approve and Return
      (comment required), and Scheduler Propose revision of an approved
      schedule; `/api/schedules/:id/approve` and `/return`; no migration.
      vitest 101/101, API smoke passed; **no browser walkthrough**
      (Playwright not installed). **Local database only.**
- [x] Phase 7 — Cancellation and request unlocking. See
      `docs/v2/phase-7-cancellation.md`, branch `feat/v2-cancellation`
      (stacked on `feat/v2-approval`): Requester cancel or ask to
      cancel, Admin confirm/decline and Cancel schedule, planner drops
      cancelled requests; migration 0028; pgTAP 68/68 for the new file,
      vitest 101/101, API smoke and an 11-check browser walkthrough passed.
      **Local database only.**
- [x] Phase 8 — Driver completion and problem reporting. See
      `docs/v2/phase-8-driver.md`, branch `feat/v2-driver-completion`
      (stacked on `feat/v2-cancellation`): Driver My Schedule shows
      published v2 trips with Complete trip (one odometer pair, after the
      trip ends) and Report a problem; `/api/schedules/:id/completion`
      and `/problems`; migration 0029; pgTAP 27/27 for the new file,
      vitest 111/111, 13-check browser walkthrough passed. Driver
      Finished Trips is still v1 until Phase 9. **Local database only.**
- [x] Phase 9 — Admin finished trips and printing. See
      `docs/v2/phase-9-finished-trips.md`, branch `feat/v2-finished-trips`
      (stacked on `feat/v2-cancellation`). **Built; Playwright
      walkthrough passed (30 checks) and the manual check passed:** migrations 0030 (follow-up link) and 0031
      (`correct_completion`, `mark_completion_done`, `handle_problem`),
      pgTAP 35/35 new (214 total), vitest 121/121, tsc/lint/build clean;
      Admin and Driver Finished Trips on v2 with a print view. **Local database only.**
- [x] Phase 9b — Remove the v1.2 screens, code and tables. See
      `docs/v2/phase-9b-remove-v1.md`, branch `chore/v2-remove-v1` (stacked
      on `feat/v2-finished-trips`): v1 Schedule, booking flow, Booking
      Approvals and Daily Vehicle Record screens, `/api/bookings` and
      `/api/records`, and the v1 client code deleted; migration 0032 drops
      `bookings`, `booking_slots`, `vehicle_records`, `vehicle_aliases` and
      their functions and rewrites `rename_vehicle`. No legacy data to carry
      over, so Phase 10 no longer migrates bookings. pgTAP 230/230, vitest
      80/80, concurrency script, tsc/lint/build clean, Playwright 30/30 and
      an 18-check smoke test passed. **Release-time only (applied with 0023
      at cutover); local database only.**
- [x] Phase 10 — End-to-end validation and migration rehearsal
  (`docs/v2/phase-10-validation.md`, branch `feat/v2-validation`): 0023 to
  0032 applied together after a backup onto a v1.2-shaped database, then
  rolled back to a backup restore and re-applied cleanly; 41 HTTP checks
  across all four roles passed; pgTAP 230/230, vitest 80/80, tsc, lint and
  build clean. Not covered: browser and print screens, the concurrency
  script, hosted environments. Local only, no app code changed.
- [x] Phase 11 — Release through the same Vercel project
  - [x] Cutover and rollback runbooks written
        (`docs/v2/cutover-runbook.md`, `rollback-runbook.md`).
  - [x] Released 2026-09-25: #40 merged to `master`, migrations 0012 to
        0032 applied to production, `migration list --linked` shows all 32.
  - [x] Checked by the owner by hand after release: role sign-ins (no
        problems reported) and a Driver assigned to each vehicle (0012 left
        them unassigned). The Schedules week view was unstyled at first;
        see the stale build cache note in `docs/MEMORY.md`.

## v2.1 (UX pass on v2.0, released 2026-09-25)

Built on `test/all-ux`, which merges the `fix/*` UX branches. No migrations.
Released through PR #46 to `master` and tagged `v2.1`.

- [x] Dialogs: height limit with scrolling, buttons pinned to the bottom,
      trip record table fits its dialog, "Go back" wording to close them.
- [x] Data freshness: refresh on screen open and focus, a Refresh button
      with "Last updated", and Settings refreshes when data changes.
- [x] Messages: plain-language API errors, success messages clear
      automatically, and clearer empty states with icons.
- [x] Home: cards show waiting work, and a Help dialog with "How this
      works".
- [x] New request: says which fields are still missing, labels and numbers
      destinations, explains the edit date rule, asks before leaving
      unsaved work. Booking Options is renamed to Request choices.
- [x] Planner: starts the Trip Record with a return leg, has a Trip Record
      checklist and warnings on each leg, explains legs and ANONANG, hints
      how to fix an unusable vehicle, and shows a date legend with reasons
      a date is unavailable.
- [x] Statuses: one glossary for status words, used on every screen;
      submitted schedules show as "Waiting for approval".
- [x] Destructive actions: cancel and discard buttons are red, and
      Remove leg asks first.
- [x] Driver: shows when Complete trip unlocks, pre-fills the odometer,
      warns on long trips, restates the distance before submitting.
- [x] Phones: tables stack as cards, 44px touch targets, icon-only Help
      and Refresh buttons.
- [x] Look: darker low-contrast text, bigger helper text, sign-in polish,
      account name in the top bar, footer below the page content.
- [x] `tsc`, lint, build and vitest (127/127) passed; released via PR #46
      (merge `c4beacc`).
- [x] Tagged `v2.0` on the pre-merge `master` (`02163bc`) and `v2.1` on
      the merge commit; recorded in `docs/v2/git-and-release.md`.

## v2.2 (released 2026-09-29)

Scope and priority order agreed with the owner 2026-09-28: Planner
request-pool rewrite (priority), Admin full powers/overrides, notifications,
button/greeting polish, route-based navigation, then a Today view/Copy for
chat (last). Each item gets its own branch and PR to `master`. **"Today
view / Copy for chat" was dropped from scope 2026-09-29** — not built, not
carried into a later version.

All items below are merged to `master` via PRs #49–#56 (2026-09-28 to
2026-09-29): #49 planner-request-pool, #50 admin-role-override,
#51 notifications, #52 topbar-declutter, #53 route-based-navigation,
#54 fix/session-loop-and-logo, #55 other-destination-purpose,
#56 return-tank-confirmation. This corrects earlier entries below that said
"not yet merged" — that was stale at the time the entries were written and
is no longer accurate.

- [x] **Planner builds legs from the request pool** — merged via PR #49
      (`feat/planner-request-pool`). The request pool is now a
      read-only status list grouped by requester; ticking a request no
      longer exists. Instead the Scheduler picks a destination via "Add
      stop" (limited to the day's request-pool destinations) and every
      unplaced request stop for that destination attaches to the leg
      automatically, merging onto an existing leg for the same destination
      rather than requiring a manual tick. A separate "Add other stop"
      button covers non-request stops (e.g. a fuel stop), limited to
      destinations an Admin flags `is_other_stop` in Settings → Request
      choices. The database (`0033_planner_request_pool.sql`) rejects a
      non-final leg with no request stops unless it's flagged as an other
      stop, closing the gap a client bug or a direct API call could
      otherwise exploit. The final leg's Time Out is now re-derived after a
      leg is added, removed or reordered, fixing a bug where it could go
      stale relative to the leg before it. Also in this pass: a leg's
      planned times are no longer required to save a draft (only to submit
      it), since `schedule_legs.planned_time_out/in` are now nullable and
      `assert_revision_complete` checks them at submit time instead of
      `write_revision_content` requiring them at every save — a time
      reservation is only recorded once every leg is fully timed.
      `tsc --noEmit`, `lint`, `vitest` (139/139) and `next build` pass; a
      new pgTAP file (`v2_planner_request_pool.test.sql`) covers the
      other-stop rule and the optional-times behavior, and the full pgTAP
      suite (237/237) passes against a local `supabase db reset`. Not yet
      walked through in a real browser.
- [x] **Admin full powers/overrides** — merged via PR #50
      (`feat/admin-role-override`). Not impersonation: Admin's own
      account temporarily gains the ability to perform Scheduler and Driver
      writes, attributed to Admin, never to any Scheduler/Driver account.
      `0034_admin_role_override.sql` widens `save_schedule_draft`,
      `submit_schedule`, `discard_schedule_draft` to also accept Admin
      (create schedule, save draft, submit, discard, propose a revision —
      additively, alongside the existing Scheduler-only path), and widens
      `submit_completion`/`report_problem`'s Driver-ownership check to also
      accept Admin for any vehicle's trip, since Admin has no `driver_id` of
      their own — the completion/report is recorded with Admin's own account
      id. Admin's pre-existing powers (approve, return, cancel, correct
      completion, mark done, handle problem) are untouched and never flagged
      as an override. A new `audit_events.is_admin_override` boolean (default
      `false`), set via the same transaction-local `kova.audit_action`-style
      config the RPCs already use, records exactly when Admin acted outside
      their own role. No RLS policy changes were needed: schedule/completion
      writes are already RPC-only (`0020_v2_revoke_default_grants.sql`), and
      Admin already has full read access to every schedule and completion
      (`can_view_schedule`/`can_view_revision`, `trip_completions_select`),
      so the Driver "My Schedule" screen shows every vehicle's trips for
      Admin's view-as-Driver mode with no backend read-path change — just a
      `driverId: string | null` prop on `DriverSchedules` that skips the
      per-driver filter when null. On the frontend, Admin Home gets "View as
      Scheduler" / "View as Driver" toggles (`app/page.tsx`) that swap Admin's
      screen set for that role's own screens, with a persistent "Viewing as
      X — Return to Admin" banner; the toggle is plain React state only,
      never persisted, and always resets on refresh or sign-out. `tsc
      --noEmit`, lint, vitest (139/139) and `next build` pass; pgTAP
      (244/244, up from 237, against a local `supabase db reset`) covers
      Admin creating/submitting/discarding a schedule and completing/
      reporting a problem on another Driver's trip, both attributed to Admin
      with `is_admin_override` set, alongside unchanged rejections for
      Requester and other-Driver. Not yet walked through in a real browser.
- [x] **In-app notifications** — merged via PR #51 (`feat/notifications`).
      An in-app notification center, not email/push: a bell icon
      with an unread-count badge in the top bar opens a dropdown of recent
      events, backed by a new `notifications` table
      (`0035_notifications.sql`). Every notification is written from inside
      the existing RPC that causes the event, in the same transaction as the
      change itself: `submit_schedule` notifies every Admin; `approve_schedule`
      notifies each newly-scheduled Requester and the assigned Driver
      (trip published); `return_schedule` notifies the Scheduler;
      `request_cancellation` notifies every Admin; `decline_cancellation`
      notifies the Requester; `confirm_cancellation` notifies the cancelled
      Requester and, if it cascades into cancelling the whole schedule, every
      other Requester released back to the pool; `cancel_schedule` (direct
      Admin cancel) notifies each released Requester; `report_problem`
      notifies every Admin. Read access and mark-read are both RLS/RPC-only
      (`mark_notification_read`, `mark_all_notifications_read`) — no client
      ever gets a direct insert/update grant on the table.
      **Not Supabase Realtime**: this app's frontend never talks to Supabase
      directly (see `docs/ARCHITECTURE.md`), so live updates go through a new
      `GET /api/notifications/stream` Server-Sent-Events route of KOVA's own
      that polls the signed-in account's notifications every few seconds and
      pushes anything new; the stream closes itself well under a Vercel
      function's duration limit and the browser's `EventSource` reconnects on
      its own. `tsc --noEmit`, lint, vitest (139/139) and `next build` pass;
      a new pgTAP file (`v2_notifications.test.sql`, 26 checks) covers every
      RPC's notification(s) and RLS isolation between accounts (270/270
      total). Walked through in a real browser (headless Chromium against
      the local Supabase instance): a notification inserted while signed in
      appeared live within the poll interval, the badge count and panel
      contents were correct, marking one read and "Mark all read" both
      cleared the badge with zero console errors.
- [x] **Button/greeting polish** — merged via PR #52
      (`feat/topbar-declutter`). Top bar decluttered: Refresh, Notifications and Help
      are icon-only with tooltips on all widths (previously text-labeled on
      desktop), the "Updated HH:MM" text folds into the Refresh button's
      tooltip, and the avatar/name/role block was removed at the owner's
      request. Admin Home's greeting now reads "Welcome, {name}" like every
      other role instead of a static "Admin Home", so all four roles are
      greeted consistently. Audited button consistency (all 6 non-shadcn
      raw `<button>` usages found to be intentional bespoke cards/links, not
      inconsistency) and the loading/disabled-state convention on every
      mutating button app-wide (cancellation confirm/decline, Driver trip
      completion/problem report, account/vehicle save, password change,
      booking-options save, in addition to the already-known Submit
      request/Save draft/Approve/Sign In) — all already correctly implement
      `disabled={busy}` + a loading label, so no fix was needed; the
      convention is now documented in `docs/DESIGN.md`. `tsc --noEmit` and
      lint pass; verified visually via an isolated static render of the
      actual topbar CSS (a full authenticated browser walkthrough wasn't
      possible — this environment's local Supabase project doesn't have the
      `admin1`/`test1234` UAT seed account provisioned).
- [x] **Route-based navigation** — merged via PR #53
      (`feat/route-based-navigation`, branched from `master`, not from
      `feat/topbar-declutter`, per the owner's request). Every screen now has its own URL
      instead of one address with client-side screen-switching: `/sign-in`,
      `/home` (role-branched dashboard, absorbing all four old `*-home`
      screens), `/settings` (Admin), `/requests` + `/requests/new`
      (Requester/Admin), `/schedules` + `/schedules/new` (Scheduler/Admin),
      `/my-schedule` (Driver), and `/finished` + `/finished/driver` (Admin vs.
      Driver audience for the same screen). Auth is gated by `proxy.ts` (this
      Next.js version's renamed `middleware.ts`) doing a lightweight
      session-cookie presence check and redirecting signed-out requests to
      `/sign-in`; the authoritative check stays in
      `app/api/auth/session/route.ts`, called by the new
      `app/(app)/layout.tsx` shared shell (topbar, session/account state,
      data-refresh and notification effects, the unsaved-changes confirm
      dialog — all moved verbatim out of the old single `app/page.tsx`).
      `app/(app)/providers.tsx` exposes `account`/`viewAs`/`viewRole`/`leave`
      via context; Admin's "View as Scheduler/Driver" toggle stays
      client-state only, as agreed — the URL never changes when Admin
      toggles it, only `/home`'s content re-renders, and it still resets on
      every sign-in/refresh. Each route's own `page.tsx` enforces who can see
      it via a small `<RequireRole>` guard, redirecting to `/home` otherwise.
      None of the leaf screen components (`Settings`, `RequestFlow`,
      `MyRequests`, `SchedulePlanner`, `Schedules`, `DriverSchedules`,
      `AdminFinishedTrips`, `DriverFinishedTrips`) needed internal changes —
      only the callbacks passed into them changed from `setScreen(...)` to
      `router.push(...)`. Transient values that used to ride along with a
      screen switch (submit notices, the schedule being edited, a chosen
      date) are now URL search params (`?notice=`, `?scheduleId=`, `?date=`)
      instead, so they survive a refresh; the old `app/page.tsx` is now a
      4-line `redirect("/home")` so stale bookmarks to `/` still land
      somewhere. `tsc --noEmit`, lint, vitest (139/139) and `next build` all
      pass; every route's signed-out redirect to `/sign-in` was verified
      against a running dev server with curl. **Not verified**: a signed-in
      click-through (no UAT seed account is provisioned in this
      environment's Supabase project, the same gap noted on the
      button/greeting-polish item above), and the known limitation that the
      browser's native Back button can't be intercepted by the
      unsaved-changes guard the way an in-app Back button could — flagged for
      the next real-browser pass rather than silently worked around.
- [x] **"Other" destination and purpose on a request stop** — merged via
      PR #55 (`feat/other-destination-purpose`). Mirrors the
      existing Project/Site "Other" pattern: a Requester can type free text
      for a stop's Destination or Purpose instead of only picking from the
      list, via an "Other…" entry that reveals a text box.
      `0036_request_other_destination_purpose.sql` makes
      `request_destinations.destination_id`/`purpose_id` nullable and adds
      `destination_is_other`/`purpose_is_other` booleans with check
      constraints; `insert_request_destinations` validates the new
      `destinationOther`/`purposeOther` fields the same way
      `resolve_request_project` already validates Project/Site Other text.
      This reached further than the request form: the Planner's leg-builder
      RPC (`write_revision_content`) previously required every leg's
      destination to match an Active `booking_options` row, which an Other
      destination has none of by design — a leg serving only Other-text stops
      now derives its destination from the stops themselves instead, and two
      Other stops only share a leg when their free text matches exactly (the
      same rule an id match already enforces for a normal destination).
      `lib/trip-record.ts`'s pool-grouping and leg-matching, previously keyed
      everywhere by `destinationId`, now key by a `stopGroupKey`/`legGroupKey`
      that falls back to the free text when there's no id, so
      `poolDestinationChoices`, `pickLegDestination` (replacing the earlier
      `addPoolLeg`) and `candidatesForLeg` all work correctly for both. One
      real bug was found and fixed while verifying this by hand: a
      composite/row PL/pgSQL variable's own `IS NOT NULL` check is true only
      when *every* field is non-null, which is never true for an Other stop's
      row since `destination_id`/`purpose_id` are null by design — fixed by
      checking a field that's never null (`.id`) instead of the row itself.
      **Followed by a Create Schedule UI/UX pass** (three more commits on the
      same branch) after the owner found the original leg-builder screen too
      cluttered: the separate top-level pool-destination dropdown, the manual
      "Add other stop" button, and "other" wording throughout were all
      removed. A leg's destination is now chosen from one per-leg dropdown
      (shown once a blank leg has no stops yet) with two labelled groups,
      "From the request pool" and "Fuel/errand stops" — the latter sourced
      from booking options an Admin flags in Settings → Request choices,
      relabelled from "Other stop" to "Fuel/errand stop" there
      (`app/booking-options.tsx`) since it's an operational flag, not a
      Requester-facing Other option. Picking a pool entry attaches every
      unplaced stop sharing its group key, same as before; picking a
      fuel/errand entry leaves the leg stop-free. `tsc --noEmit`, lint, vitest
      (148/148) and `next build` all pass; a new pgTAP file
      (`v2_request_other.test.sql`, 12 checks) covers the validation rules,
      the Planner leg-builder deriving a destination from an Other stop, and
      two differently-named Other stops being rejected from sharing a leg
      (282/282 total, against a local `supabase db reset`). The owner
      click-tested the redesigned Create Schedule page locally (against a
      local Supabase instance, not the hosted `kc-kova` project) and
      confirmed the picker is correct; the Other-destination/purpose request
      flow itself has not yet had its own real-browser click-through.
- [x] **Final return / full-tank confirmation on Complete trip** — merged
      via PR #56 (`feat/return-tank-confirmation`). The paper
      Daily Vehicle Trip form's "FINAL RETURN / FULL-TANK CONFIRMATION"
      section (full-tank confirmation, fleet card used, gas receipt attached)
      was previously left as blank checkboxes for handwriting
      (`app/finished-trip-print.tsx`) with nowhere in the app to answer them.
      `0037_return_tank_confirmation.sql` adds three nullable booleans to
      `trip_completions` (`full_tank`, `fleet_card_used`,
      `gas_receipt_attached`; null means not answered, distinct from an
      explicit false) and widens `submit_completion` to accept them as
      optional parameters, defaulting to null — none of the three are
      required to complete a trip, matching the owner's explicit direction.
      The Driver's Complete trip step (`app/driver-schedules.tsx`) is now two
      screens: enter and confirm the odometer pair first (Next is disabled
      until the readings are valid), then a second "Final return" screen with
      the three checkboxes — "Vehicle returned with a full tank", "Fleet card
      used", "Gas receipt submitted" (worded to prompt the Driver to actually
      turn it in; the printed form keeps "GAS RECEIPT ATTACHED" unchanged) —
      before Submit trip. None of the three are required, per the owner's
      explicit direction, and the UI never says "optional" out loud; leaving
      them unchecked just submits null. `correct_completion` (Admin's
      odometer correction) is untouched, since these fields aren't part of
      that flow. The printed form's three checkboxes now render ☑ when the
      Driver checked the corresponding box and ☐ otherwise, instead of always
      being blank. Also on this branch: two sitewide CSS fixes found while
      click-testing this flow — outline buttons (e.g. "Back") defaulted to
      shadcn's 36px height while the app's own `.primary` class forced 44px,
      visibly mismatching any Back/Next or Back/Submit pair, so every
      default-size button is now 44px; and dialog text could render with
      stale/clipped glyphs after content reflows (e.g. a helper line mounting
      as you type) because of a known Chrome repaint bug with
      `fixed` + `translate(-50%,-50%)` dialogs, fixed by promoting the dialog
      to its own compositing layer (`will-change: transform`). `tsc --noEmit`,
      lint, vitest (151/151) and `next build` all pass; `v2_completion.test.sql`
      gained 5 checks covering the new fields' null-by-default behavior and
      being recorded correctly when answered (287/287 total, against a local
      `supabase db reset`). Click-tested locally by the owner (local Supabase,
      not `kc-kova`): odometer entry, the Final return screen, and submission
      all worked; the button-height and text-clip fixes were prompted by that
      pass but still need a final look on other screens.
- [x] **Open problems on unsubmitted trips were unreachable** — branch
      `fix/unfinished-trip-problems`. Admin Home's Finished Trips card
      counted every open problem report, but the Finished Trips screen only
      listed trips with a submitted completion, so a problem a Driver
      reported before submitting (allowed: problem reports have no time
      limit) was counted but couldn't be seen or handled anywhere. The
      Admin screen now uses `buildAdminTrips` (`lib/finished-trips.ts`),
      which adds trips that have a problem report but no completion, shown
      as "Not submitted yet" (new Status filter option) with only problem
      handling available — no odometers, correction, Mark as done or Print
      until the Driver submits. The Driver's Finished Trips screen is
      unchanged. `tsc --noEmit`, lint, vitest (153/153) and `next build`
      pass; not yet click-tested in a browser.
- [x] **Request pool: Urgent first, and send back what won't fit** — branch
      `feat/request-pool-priority`. The planner pool, the "From the request
      pool" destination list and the day picker now put Urgent requests
      first (`poolOrder`, `poolDestinationChoices`, "N urgent" on each day),
      and the submit dialog warns when an Urgent request is left off the
      route. A request that doesn't fit can be sent back to its requester
      (per request, or "Send back all unplaced"), with an optional reason:
      migration 0038 adds `send_back_requests`, a new `SENT_BACK` progress
      and a `REQUEST_SENT_BACK` notification. The requester sees "Sent back"
      in My requests and picks another day (Edit) or cancels; a new date
      puts it back in the pool. `tsc --noEmit`, lint, vitest (158/158) and
      `next build` pass; `v2_send_back.test.sql` (13 checks) passes, and the
      round trip was smoke-tested through the API on a local dev server. The
      other pgTAP files weren't re-run (they need a local `supabase db
      reset`). Click-tested in headless Chrome (Playwright) against local
      Supabase as `sched1` and `req1`: day-picker urgent count, Urgent-first
      pool and dropdown, single and bulk send-back, and My requests "Sent
      back" → Pick another day, with no console errors. That pass found and
      fixed a sent-back request being counted as "already in another
      schedule". Follow-ups from the owner's click-through: submit no
      longer needs every pool request on the route; the submit dialog lists
      what's left off and sends it back (ticked by default); and a request
      only partly on the route is split (migration 0039, `split_request`),
      so its other stops can go on another car or back to the requester.
      `v2_split_request.test.sql` (12 checks) passes; the split-on-submit
      flow was click-tested end to end.
- [x] **Urgent covers today up to 6 days ahead** — branch
      `feat/urgent-within-week`. Urgent used to be today or tomorrow only,
      so dates 2–6 days ahead couldn't be requested at all. Migration 0040
      changes `check_request_date` so Urgent is today to 6 days ahead and
      Regular stays 7+ days ahead: every future date suits exactly one type.
      The form (`requestDateError`), the New request date strip and legend,
      the type picker, the edit dialog and Help all follow. vitest
      (153/153), lint and `next build` pass; `v2_urgent_window.test.sql`
      (7 checks) passes; `v2_requests.test.sql`'s old "Urgent 2 days ahead
      is rejected" check now uses 7 days, but that file wasn't re-run (it
      needs a local `supabase db reset`). Re-run 2026-10-02 against a clean
      `supabase db reset`: all 12 pgTAP files pass (319/319).

## v2.5 (simplification pass, 2026-10-02)

From the 2026-10-02 system audit. One PR each, stacked in order.

- [x] Remove 52 unused vendored UI components and 14 unused npm packages.
- [x] CI runs the pgTAP suite and `concurrency.sh` on a fresh database.

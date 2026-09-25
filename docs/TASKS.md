# KOVA — Task Status

Kept as a living checklist of what's implemented vs. outstanding. Update
this file whenever a task's status changes.

## Status: v1.0 complete — in UAT (2026-09-22)

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
- [ ] **pgTAP / integration tests proving RLS isolation are still not a
      committed, automated suite.** The manual verification exists (see
      the local-instance and production Done items above: anon denied
      everywhere, Driver ownership isolation, Admin full access, all four
      RPCs end-to-end) but was run by hand against a local instance, not
      as CI-checked tests. Turning it into a real pgTAP or integration
      suite (e.g. against a Supabase instance spun up in CI) so this is
      checked on every change, not just once by hand, remains open.
- [ ] **`vehicle_records` writes run through application code + the
      service-role client, not a Postgres RPC** (see
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
- [ ] **Trip leg buttons and final return.** Reworks Trip Record leg entry
      to be Driver-button-driven instead of auto-generating a return leg.
      - **Initial leg:** a new record starts with just LEG 01, Origin fixed
        to ANONANG, Destination pre-filled from the booking's scheduled
        Destination when available (Driver may edit the actual
        Destination). No return leg is auto-created.
      - **Buttons:** `+ ADD LEG` and `+ ADD FINAL LEG` render side by side
        beneath the last leg's fields, and the row moves down to stay below
        the last leg as more legs are added (stack instead of side-by-side
        on narrow/mobile widths, both remaining easily tappable).
      - **Add Leg:** appends a normal leg with Origin auto-set to the
        preceding leg's Destination, Destination left editable, and every
        previously entered field untouched.
      - **Add Final Leg:** appends the one allowed return leg, with Origin
        auto-set to the preceding leg's Destination and Destination fixed
        to ANONANG (read-only); Time Out/Time In/Requestor/Purpose-Activity/
        contact fields stay optional and editable. Only one final leg is
        allowed at a time — both buttons hide while it exists. The Driver
        may remove it before submission, which re-shows both buttons below
        the new last leg. While present, its Origin stays in sync if the
        preceding leg's Destination changes.
      - **Validation:** the route must start and end at ANONANG, and every
        Origin after the first must match the preceding leg's Destination,
        both enforced client-side and re-checked server-side on submission;
        a missing final leg blocks submission with "Add a final leg to
        return to ANONANG." Actual trip times (Time Out/Time In) are never
        auto-filled. Older saved records must still load and submit without
        data loss under the new rule, and the leg list carries through to
        the PDF as today.
- [ ] **Finance "Date Submitted" from `submittedAt`.** Backend sets
      `submittedAt` once, authoritatively, on the Driver's successful
      submission — never reset by Admin edits, printing, or Mark as Done,
      and rejected if a client tries to supply/forge it directly. Finance
      displays it read-only, derived from the org's configured business
      timezone (default `Asia/Manila` if none is configured — document
      this default), distinct from the scheduled trip date, Finance
      processing date, and Done date. Carries through to the PDF.
      Historical `submittedAt` values must not be migrated/overwritten.
- [ ] **Official logo + KOVA lockup.** Replace the placeholder logo with
      the official company logo (used as-is: no redraw/crop/stretch/
      recolor/substitute) on Sign In, the app header, and compact/mobile
      headers, arranged as `[logo] · KOVA` with "Kayelen's Operations and
      Vehicle Allocation" in smaller text beneath KOVA. Must wrap/scale
      cleanly on narrow screens without colliding with nav or Sign Out,
      and must still print clearly in the Daily Vehicle Record PDF header.
- [ ] **Mobile Driver experience.** Audit and fix the full Driver journey
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
- [ ] **Mobile-responsive Booking Type + Approval flow.** The v1.1 screens
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

## Planned — v2.0 (phased upgrade, not started)

Full plan adopted 2026-09-24: `KOVA-v2-Claude-Implementation-Plan.md` (repo
root), indexed at `docs/v2/PLAN.md`. Upgrades the **same** repo, Vercel
project and production database in place across four roles (Requester,
Scheduler, Admin, Driver) and 13 phases (0–12); see `docs/v2/PLAN.md` for
the phase table. Each phase requires explicit "May I start Phase N?"
approval before starting — approving the overall plan is not approval for
any individual phase. Phase 0 (inspect v1.2, verify reported behavior,
build a cleanup inventory, list conflicts) was proposed 2026-09-24 and is
pending approval; nothing has started.

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
- [ ] Phase 3 — Database model, permissions, state transitions, full
      `requester` role migration
- [ ] Phase 4 — Requester and Admin request creation
- [ ] Phase 5 — Scheduler planning and Trip Record
- [ ] Phase 6 — Approval, revisions and publication
- [ ] Phase 7 — Cancellation and request unlocking
- [ ] Phase 8 — Driver completion and problem reporting
- [ ] Phase 9 — Admin finished trips and printing
- [ ] Phase 10 — End-to-end validation and migration rehearsal
- [ ] Phase 11 — Release through the same Vercel project
- [ ] Phase 12 — Stabilize and hand over

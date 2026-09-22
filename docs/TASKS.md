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

## Planned — v1.1 (prospecting only, not started)

Scoped 2026-09-22 while v1.0 is in UAT. **Nothing below is built yet** —
this is a prospect list to build from once UAT feedback comes in; more
items will be added after that pass. Constraints that apply to all of it:
keep exactly the three existing roles (Booker, Driver, Admin) and the
existing three-step booking flow (Choose Date → Vehicle & Time → Booking
Details); extend existing components rather than rebuilding; no Company
Trip Form and no Form Type choice — remove either if found on a working
branch; small Add/Edit actions stay popups; never rely on a hidden button
as permission enforcement (every rule needs a real backend check); no demo
accounts or browser-only-authoritative data.

- [ ] **Vehicle → Driver assignment.** Selecting a Vehicle in booking Step
      2 auto-resolves its one current active Driver (no separate Driver
      picker in the normal flow). Admin Settings → Vehicles gets an
      "Assigned Driver" dropdown (active Drivers only) in the existing
      Add/Edit popup, and the Vehicles list shows each Vehicle's assigned
      Driver or "No Driver assigned." One Driver ↔ one Vehicle at a time,
      enforced server-side (uniqueness, inactive Drivers unassignable, a
      Vehicle with no active Driver isn't bookable). Reassigning a Driver
      must not rewrite or silently change the Driver on already-confirmed
      bookings — each booking snapshots the Vehicle/Driver it was
      confirmed with, by stable ID, not by name. Edit Booking re-resolves
      the proposed Driver when the Vehicle changes and rechecks
      availability before saving. Vehicle and Driver conflict checks stay
      independent (a different Vehicle referencing the same Driver must
      still conflict correctly).
- [ ] **Paste multiple Destinations/Purposes.** Admin → Settings → Booking
      Options gets a "Paste List" action next to the existing single-item
      Add, opening a popup with a multiline textbox ("Paste one item per
      line"), a preview of what will actually be added, and counts for
      skipped blank lines / in-paste duplicates / already-saved entries.
      Dedup case/whitespace-insensitively against both Active and
      Inactive saved options (an Inactive match is reported as existing,
      never auto-reactivated or re-created under a new ID); valid new
      entries save as Active. A save failure keeps the pasted text on
      screen and surfaces the real backend error. Existing single-item
      Add/Edit and historical option values are untouched.
- [ ] **Date-strip month clarity.** Choose Date shows the visible month/year
      before any date is clicked; if the strip spans two months, each date
      is labeled or grouped by its own month, including at phone widths
      and after navigating forward/back.
- [ ] **Optional Project/Department field.** New optional Step 3 dropdown
      (Purpose's styling) of Active saved Projects/Departments plus
      "Other" (reveals a trimmed text input). Never blocks confirmation
      when empty; never invents a value if "Other" is picked with no text
      typed. Stores the option's stable ID plus a display snapshot (or the
      typed custom value for Other) so a later-Inactive option or custom
      value still renders correctly on old bookings/records. Does not
      affect ownership or Requested By. Edit Booking must correctly
      reshow all three cases (empty, saved option, custom Other,
      including a since-Inactive one).
- [ ] **Automatic ANONANG return leg.** First leg's Origin is always
      ANONANG; last leg's Destination is always ANONANG and read-only for
      the Driver; every other leg's Origin auto-derives from the
      preceding leg's Destination and re-links on insert/edit/remove of
      an intermediate leg, without discarding Driver-entered values
      (times stay manual/optional). A new record pre-populates as
      `ANONANG → booked destination` / `booked destination → ANONANG`
      from the booking's scheduled Destination. Submission validation (and
      the equivalent backend validation) confirms the route starts/ends
      at ANONANG and adjacent legs connect; older saved records must load
      without data loss under the new rule. Carries through to the PDF.
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

Each item above needs its own confirm-before-building pass per this
repo's git workflow (`CLAUDE.md`) once UAT feedback prioritizes it — this
section is scope capture, not a build order.

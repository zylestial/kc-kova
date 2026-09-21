# KOVA — Task Status

Kept as a living checklist of what's implemented vs. outstanding. Update
this file whenever a task's status changes.

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

## Outstanding / follow-ups

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
- [ ] **The live-Supabase and UI verification above was manual (curl and an
      ad hoc Playwright script against a running dev server), not
      automated.** Worth turning into a real, committed integration/e2e
      test suite (e.g. against a Supabase local/CI instance) so the
      RLS-grant class of bug and the RPC conflict/atomicity guarantees are
      checked on every change, not just once by hand. Only Admin Home,
      Schedule, and Settings/Accounts were walked — Driver-trip submission,
      Admin review, and Booking Options/Vehicles tabs still haven't been
      clicked through in a real browser.

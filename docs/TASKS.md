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

## Outstanding / follow-ups

- [ ] **No live Supabase project has been exercised yet.** Everything above
      has been verified by static type-checking, a production build, and
      unit tests of pure logic — not by running against a real database.
      The unit tests deliberately don't cover anything that touches
      Supabase itself (RLS policies, the RPC functions, or the route
      handlers' own database calls), since that needs a real project to
      run against. Before shipping: create a Supabase project, run the
      three migrations in order, populate `.env.local` from
      `.env.example`, and walk every workflow in `docs/PRD.md` end to end
      (sign in as each role; book; submit a trip; review and mark done;
      rename a vehicle; add a booking option). Once a project is available,
      add integration tests for the route handlers themselves and for the
      RPC functions' conflict/atomicity guarantees — the highest-value
      remaining test gap.
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

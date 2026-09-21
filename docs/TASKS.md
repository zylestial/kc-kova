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

## Outstanding / follow-ups

- [ ] **No live Supabase project has been exercised yet.** Everything above
      has been verified by static type-checking and a production build, not
      by running against a real database. Before shipping: create a
      Supabase project, run the three migrations in order, populate
      `.env.local` from `.env.example`, and walk every workflow in
      `docs/PRD.md` end to end (sign in as each role; book; submit a trip;
      review and mark done; rename a vehicle; add a booking option).
- [ ] **`vehicle_records` writes run through application code + the
      service-role client, not a Postgres RPC** (see
      `docs/ARCHITECTURE.md`), unlike every other write path in this app.
      This was a deliberate scope trade-off for this pass, not an oversight.
      Consider porting `app/api/records/[recordId]/route.ts`'s logic into a
      `security definer` RPC (mirroring `create_booking`) for the same
      atomicity guarantee bookings get, especially the read-modify-write
      history diff, which has a narrow race window under concurrent writes
      to the same record.
- [ ] **No automated tests exist yet** for any API route (unit or
      integration). Given the amount of business logic living in
      `app/api/records/[recordId]/route.ts` and the RPC functions, this is
      the highest-value place to start.
- [ ] **CI is not configured** — `tsc`, `eslint`, and `next build` are being
      run manually after each change; wiring these into a CI pipeline would
      catch regressions automatically.
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

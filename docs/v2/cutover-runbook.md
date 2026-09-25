# KOVA v2.0 — Cutover runbook (Phase 11)

How v2.0 replaces v1.2 in the same Vercel project (`zyha/kc-kova`) and the
same Supabase project (`rhzqdtgruhpdhopkksuf`). The order was rehearsed
locally in Phase 10 (`phase-10-validation.md`). **Nothing here has been run
against production.** Every step that touches production needs a person's
go-ahead first (`docs/RULES.md`, prohibited approaches). Rollback is in
`rollback-runbook.md`; read it before starting.

## 1. Gate: do not start until all of these are true

- [ ] The stacked PRs are merged top-down into `master` (each into its
  parent, the last one into `master`), each reviewed. `master` is not pushed
  to directly.
- [ ] Phase 10 is merged and its checks still pass on the release commit:
  `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`, vitest and, on a
  fresh `supabase db reset`, pgTAP.
- [ ] The owner has confirmed the production database still holds only test
  data, or has decided what to do with real data if that changed
  (`docs/MEMORY.md`, "No live production data exists yet"). If real data
  exists, the Preview credential-sharing decision in `environment-map.md`
  must be revisited first.
- [ ] The Supabase plan has a restore path (see `rollback-runbook.md` §2).
- [ ] The owner has given separate release approval for this run.

## 2. Preflight (read-only against production)

Use `supabase link` and `--linked`; never put the database password or a
connection string in a command or a chat.

1. `supabase migration list --linked`. Compare local files against what
   production records. Repair the history first if they disagree (the
   `migration repair` case in `docs/MEMORY.md`, 2026-09-21), before any push.
2. Confirm which of 0013 to 0022 are already applied. Previews share this
   database, so some may be.
3. Count rows in `accounts`, `vehicles`, `bookings`, `booking_slots`,
   `vehicle_records`, `people` and `booking_options`. 0032 drops the middle
   three for good, so a non-zero count needs an owner decision.
4. Take the backup (section 4) and verify it, now, so a problem shows up
   before the release window.

## 3. Ahead of cutover (additive, v1.2 keeps working)

Apply 0013 to 0022 with `supabase db push` if step 2.2 shows they are
missing. They only add tables, functions and policies. Check afterwards with
a read-only schema dump that the expected tables and policies exist, as was
done for 0006 to 0009.

## 4. Backup

Write dumps to a local, gitignored path and never print them.

1. `supabase db dump --linked -f <schema.sql>` and
   `supabase db dump --linked --data-only -f <data.sql>`.
2. **Verify, don't trust the log line.** Each file must be non-empty, the
   data file must contain `COPY` or `INSERT` statements, and it must include
   `auth.users` rows. If the CLI dump leaves the `auth` schema out, add
   `--schema auth`, or take the backup from the dashboard as well. Rollback
   needs the sign-in identities, not just the `public` tables.
3. **Stop if a check fails.** Do not go on to section 5 with a backup that
   isn't verified. In Phase 10 a failed `pg_dump` did not stop the migration
   step that followed it.
4. Also note the dashboard backup or restore point available at this moment.

## 5. Cutover

Order (the one in `phase-3-schema.md` section 7). Users are test accounts,
so pausing writes means telling them not to use KOVA during the window.

1. Announce the window and stop using the app.
2. Confirm the backup from section 4 is verified and recent.
3. Merge the release PR into `master`. Vercel builds and promotes it to
   Production. Wait until the deployment is Ready.
4. **Immediately** apply the release migrations: `supabase db push`
   (0023 to 0032 together, as rehearsed). Until this finishes, the v2 code
   is live on a v1.2-shaped schema: Bookers cannot use it. Keep the gap short.
5. Verify (section 6). If anything fails, go to `rollback-runbook.md`.
6. Resume normal use.

## 6. Verify

- `supabase migration list --linked` shows 0001 to 0032 all applied.
- `bookings`, `booking_slots`, `vehicle_records` and `vehicle_aliases` no
  longer exist; former Bookers now have role `Requester`; account count is
  unchanged.
- Sign in once as each role (Admin, Requester, Scheduler, Driver). A former
  Booker signs in with its old password and lands on the Requester home.
- Each role sees only its own screens; `/api/bookings` and `/api/records/x`
  return 404; an anonymous `/api/bootstrap` returns 401.
- Optional write check: as a Requester, file a request and cancel it, so the
  database write path is exercised (use a clearly named test request).
- Vercel shows the Production deployment healthy and no error spike.

## 7. After cutover

- Re-read `environment-map.md`: v1.2 previews (`v1-maintenance`) now point at
  a v2 database and will not work.
- If real users and data are about to enter, clear the test data as the owner
  planned, and give Preview its own Supabase project or drop its credentials.
- Remove the unused marketplace env vars listed in `environment-map.md`
  once confirmed unused.
- Log the outcome in `docs/MEMORY.md` and tick Phase 11 in `docs/TASKS.md`.

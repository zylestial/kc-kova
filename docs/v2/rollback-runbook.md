# KOVA v2.0 — Rollback runbook (Phase 11)

How to go back to v1.2 if the cutover in `cutover-runbook.md` goes wrong.
Nothing here has been run against production. Any step that touches
production needs a person's go-ahead first.

## 1. What can and cannot be undone

| Layer | Undo | Notes |
|---|---|---|
| Code | Promote the last v1.2 deployment in Vercel, or redeploy tag `v1.2-stable` | Restores code only |
| Database | Restore into a **fresh** database | Never migrate backwards |

A code rollback alone is not enough once 0023 has run: v1.2 code only knows
the `Booker` role, so converted accounts cannot use it. After 0032 the v1.2
tables are gone, so v1.2 cannot run at all until the database is restored.
Both halves must be done together.

## 2. Decide the database path before cutover

Rehearsed in Phase 10: restoring into a fresh database works and the release
migrations then apply cleanly again. Restoring **over** the migrated database
does not (`pg_restore --clean` leaves functions added after the backup, and the
next forward migration fails). So the choices are:

1. **Supabase dashboard backup restore or point-in-time recovery.** Replaces
   the whole database, so it is a true rollback. It depends on the plan; check
   before cutover that one is available and note the restore point taken just
   before section 5 of the cutover runbook.
2. **New Supabase project.** Create a project, load the verified backup into
   it (schema and data including `auth.users`), and point the Vercel
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` at it, then redeploy. Nothing is destroyed, but
   the project ref changes.
3. **Reset the `public` schema in place and reload the backup.** Destructive
   against production: needs the owner's explicit confirmation, and the
   backup must be verified first. Last resort.

## 3. Roll back

1. Stop use of the app. Say why to the owner before doing anything.
2. Take a fresh backup of the current (v2) state, verified as in the cutover
   runbook, unless the database is unusable. It is evidence and may be needed.
3. Restore the database by one of the paths in section 2, from the backup
   taken before cutover.
4. Promote the v1.2 deployment in Vercel (or redeploy `v1.2-stable`). If the
   merge to `master` is being reverted as well, do that with a reviewed
   revert PR, not a force-push.
5. Verify v1.2: `supabase migration list --linked` shows the pre-cutover
   state; sign in as each v1.2 role; a Booker sees the booking screens.
6. Log what failed and why in `docs/MEMORY.md` before trying again.

## 4. Forward fix instead

If the failure is small (a wrong screen, a bad permission) and the database
migrated correctly, fixing forward is usually safer than a restore. Ship the
fix as a new migration or a code change; never edit an applied migration.
Roll back for a broken migration, lost sign-in, or data problems.

## 5. Not rehearsed

- The role-reversal SQL in `phase-3-schema.md` section 7 was not run. After
  0032 it is not enough on its own, because the v1.2 tables are gone.
- No restore has been done on hosted Supabase; only the local equivalent.
- Whether the plan offers backups or PITR is unchecked.

# KOVA — Task Status

Kept as a living checklist of what's implemented vs. outstanding. Update
this file whenever a task's status changes. Detail for everything before
v2.5 is in [`archive/TASKS-history.md`](archive/TASKS-history.md).

## Status: v2.5 (2026-10-02)

v2 is live. The 2026-10-02 audit's simplification pass (below) is merged or in
review. `tsc --noEmit`, `eslint`, `vitest`, `next build`, the pgTAP suite and
`concurrency.sh` all run in CI on every PR.

## Releases

| Release | Date | What |
| --- | --- | --- |
| v1.0 | 2026-09-22 | Fleet booking and the Daily Vehicle Record, in UAT. v1.1 (booking approval) and v1.2 (prospecting) were planned and superseded by v2. |
| v2.0 | 2026-09-25 | Requester / Scheduler / Admin / Driver workflow, schedules with an approved Trip Record, completions, problem reports, cancellations (phases 0–11). |
| v2.1 | 2026-09-25 | UX pass: dialogs, data freshness, plain-language messages, phone layout (PR #46). |
| v2.2 | 2026-09-29 | Planner request pool, Admin role override, notifications, route-based navigation, other destination/purpose, return tank confirmation (PRs #49–#56). |
| v2.3–v2.4 | 2026-10-01 to 10-02 | Problems on unsubmitted trips; Urgent first, send back and split in the pool; Urgent covers today to 6 days ahead (migrations 0038–0040). |
| v2.5 | 2026-10-02 | Simplification pass (below). |

## Outstanding / follow-ups

- [ ] **Zod (or similar) boundary validation** is not rolled out. Routes validate bodies by hand (`typeof body?.x === "string"`) or through small parsers in `lib/*-input.ts`; `lib/api-route.ts` now gives every route one place to hook a schema in. `zod` is a direct dependency (used by `lib/env.ts`).
- [x] **Password policy**: 8+ characters with a letter and a number, not containing the username (`lib/password-policy.ts`, enforced in both account routes). Stronger rules (length, expiry) still need a decision from the organization.
- [ ] **Rate limiting** only covers sign-in. If abuse becomes a concern on other write endpoints, the `login_attempts` pattern could be extended.
- [x] **Browser tests**: a small Playwright suite in `e2e/` (sign-in per role, each role's screens, request → schedule → approval, the Driver's trip record → Admin Done, request and schedule cancellations) runs in CI as the `e2e` job against a local Supabase seeded by `scripts/seed-uat.mjs`. Run locally with `pnpm exec playwright test` (needs local Supabase, `.env.local`, and the seed). Still uncovered: the Driver's trip record, Admin review and Done, cancellations.
- [ ] **`docs/PRD.md`, `RULES.md` and `DESIGN.md` have not been reviewed by KOVA's operators.** They were written from the code and the schema; treat them as a first draft to correct.
- [ ] **`docs/PRD.md` has no success metrics or acceptance criteria.** Not invented here since no stakeholder input exists; logged as an open question in `docs/MEMORY.md`.

## v2.5 (simplification pass, 2026-10-02)

From the 2026-10-02 system audit. One PR each, stacked in order.

- [x] Remove 52 unused vendored UI components and 14 unused npm packages.
- [x] CI runs the pgTAP suite and `concurrency.sh` on a fresh database.
- [x] Request type is set from the date; the Requester no longer picks it.
- [x] Remove the unused People list and the hidden account `project` field.
- [x] Poll notifications every 30s instead of an SSE stream; fix the bell not
      redrawing when new notifications arrived.
- [x] Date range quick picks (Today, This week, This month, Last month,
      Custom) on Finished Trips and My requests; Progress and Type filters on
      My requests; Requester filter on Schedules.
- [x] Finished Trips: "Mark N clean trips done" closes every submitted trip
      with no open problem among those the filters show, after a
      confirmation that lists them.
- [x] Startup loads a 90-day window (plus anything older still needing
      someone), with a "Load older records" button; migration 0041 adds
      `requested_date` to `request_progress`; `v2_progress_window.test.sql`
      (3 checks).
- [x] `authed()` wrapper (`lib/api-route.ts`) replaces the sign-in boilerplate
      in 29 route handlers (-136 lines); an anonymous caller now gets 401
      before the booking-option group check.
- [x] All screens read data through `useKovaData()` instead of ten copies of
      a `kova-data-update` listener. This also fixed the Home card counts not
      redrawing after a refresh; eight unused getters were removed.
- [x] Planner split: `app/schedule-planner.tsx` 1,033 -> 441 lines, with ten
      presentational parts in `app/planner/`. Behaviour unchanged (checked in a
      browser: build a leg, save, submit/discard/send-back/remove dialogs).
- [x] Docs trim: `docs/MEMORY.md` 1,076 -> ~430 lines and `docs/TASKS.md` 823 ->
      ~65, with the history moved verbatim into `docs/archive/`; the PRD is
      rewritten for v2; references to moved sections repointed.

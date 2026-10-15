# KOVA — Task Status

Kept as a living checklist of what's implemented vs. outstanding. Update
this file whenever a task's status changes. Detail for everything before
v2.5 is in [`archive/TASKS-history.md`](archive/TASKS-history.md).

## Status: v2.6 (2026-10-08)

v2 is live. The next release is v2.7 (`feat/stop-times`, not merged yet).
`tsc --noEmit`, `eslint`, `vitest`, `next build`, the pgTAP suite,
`concurrency.sh` and the Playwright suite (`e2e`) all run in CI on every PR.
In progress (2026-10-14): the Company Trip flow on `feat/requester-vehicle`.

## Releases

| Release | Date | What |
| --- | --- | --- |
| v1.0 | 2026-09-22 | Fleet booking and the Daily Vehicle Record, in UAT. v1.1 (booking approval) and v1.2 (prospecting) were planned and superseded by v2. |
| v2.0 | 2026-09-25 | Requester / Scheduler / Admin / Driver workflow, schedules with an approved Trip Record, completions, problem reports, cancellations (phases 0–11). |
| v2.1 | 2026-09-25 | UX pass: dialogs, data freshness, plain-language messages, phone layout (PR #46). |
| v2.2 | 2026-09-29 | Planner request pool, Admin role override, notifications, route-based navigation, other destination/purpose, return tank confirmation (PRs #49–#56). |
| v2.3 | 2026-10-01 | UI pass; problems on unsubmitted trips (PRs #58–#60). |
| v2.4 | 2026-10-02 | Urgent first, send back and split in the pool; Urgent covers today to 6 days ahead (PRs #62–#63, migrations 0038–0040). |
| v2.5 | 2026-10-02 | Simplification pass (below) (PRs #65–#77, migration 0041). |
| v2.6 | 2026-10-08 | Auth hardening, Zod validation, Playwright suite, UI refresh, dashboard tile filters, trip attendance with tap addresses, trip table filters and sorting (PRs #78–#107, migrations 0042–0043). |

Each release ends at its last merge on `master`: v2.2 `d0d5db2`, v2.3
`7d45c5b`, v2.4 `c0e45cd`, v2.5 `1f3c516`, v2.6 `373a0ce`. Only v2.0 and
v2.1 have git tags so far (plus the old `v1.2-stable`).

## Outstanding / follow-ups

- [x] **Zod boundary validation**: every API route that takes a body checks it with a Zod schema (`lib/validation.ts`, `lib/*-input.ts`), with the same messages and status codes as before.
- [x] **Password policy**: 8+ characters with a letter and a number, not containing the username (`lib/password-policy.ts`, enforced in both account routes). Stronger rules (length, expiry) still need a decision from the organization.
- [ ] **Rate limiting** only covers sign-in. If abuse becomes a concern on other write endpoints, the `login_attempts` pattern could be extended.
- [x] **Browser tests**: a small Playwright suite in `e2e/` (sign-in per role, each role's screens, request → schedule → approval, the Driver's trip record → Admin Done, request and schedule cancellations) runs in CI as the `e2e` job against a local Supabase seeded by `scripts/seed-uat.mjs`. Run locally with `pnpm exec playwright test` (needs local Supabase, `.env.local`, and the seed). Still uncovered: the Driver's trip record, Admin review and Done, cancellations.
- [x] **Phone Back button and done trips (`fix/mobile-back-and-done-trips`, 2026-10-05)**: Back in the phone top bar; trips marked Done leave Schedules and My Schedule; pending schedules first; read-only Finished Trips for Schedulers (no migration).
- [x] **Dashboard tile filters (`feat/dashboard-tile-filters`, 2026-10-05)**: each tile opens its screen filtered to what it counts; Schedules gets an All dates view so a status filter shows every match. Merged (PR #88).
- [x] **Trip attendance (`feat/trip-attendance`, 2026-10-07)**: the Driver taps Start trip and End trip at ANONANG (time plus phone location, flagged if over 150 m away, without a location or late); both are required before Complete trip. Admin gets an Attendance screen. Merged (PR #100) and migration 0042 applied to production. Demo data: `scripts/seed-attendance-demo.mjs` (local by default; a hosted project needs its keys and `--confirm`). It books the same UAT vehicles and days as `seed-v2-demo.mjs`, so run one or the other on a given day.
- [x] **Tap addresses (`feat/attendance-address`, 2026-10-07)**: each Start/End tap with a position gets an approximate address from OpenStreetMap (Nominatim), shown as "near …" on Attendance and My Schedule for taps away from base. Merged (PR #102); migration 0043 to apply to production. Taps before it have no address.
- [x] **Rough location readings (`fix/attendance-accuracy`, 2026-10-07)**: a tap at ANONANG read 350 m away. The phone now listens up to 10 s for its best fix, a tap counts as at base if it could be within 150 m given the phone's accuracy (at most 250 m of it), and the accuracy shows as "(±… m)". No migration. Merged (PR #103).
- [x] **Trip table filters and sorting (`feat/trip-table-filters-sort`, 2026-10-08)**: My Schedule gets Dates, Vehicle and Status filters when an Admin views as Driver (a Driver sees their trips grouped Today / This week / This month / Other trips instead, `feat/my-schedule-sections`); every trip table gets sortable headings, with a Sort by picker on phones and on Schedules. No migration.
- [x] **Planner feedback (`fix/planner-feedback`, 2026-10-08)**: "Draft saved" and save errors show in the Planner's bottom bar (they were rendered under it, so never seen); Create schedule opens on the first day with requests waiting, and lists waiting days outside the 14-day strip; a leg with a Time Out but no Time In (the default the Planner fills in) no longer blocks Save draft, and is saved as no times; drafts with no times no longer break loading the app (`hhmm` in `lib/supabase/mappers.ts`). No migration.
- [x] **Scheduler flow follow-ups (`fix/scheduler-follow-ups`, 2026-10-08)**: the Planner drops its STEP 1–3 panel labels (the top stepper stays) and the pool says to pick a destination in the Trip Record; nothing claims time is reserved unless every leg has times; on phones the bar is one row (icon-only Discard, "Submit") and Schedules folds its filters behind a "Filters" button (`.filters-collapsible`) with one-line empty days; week cards show the plate only; the Trip Record table says "Requester" (the printed form keeps the official "REQUESTOR"); the pool's ○/✓ are spaced; Schedules says "You're still planning this" to the draft's Scheduler; an empty commitments panel is one line. From walking through return, resubmit, approve, revision, send-back, split and clashes: a clash now blocks Save and Submit and shows on the checklist (it said "Ready to submit"); Discard says "changes" or "revision" when it isn't a new draft. No migration.
- [x] **Phone follow-ups (`fix/phone-filter-fold`, 2026-10-08)**: every filter row with more than a Sort by picker folds behind a "Filters" button on phones (`app/filter-fold.tsx`: Schedules, Admin Finished Trips, Attendance, My requests, My Schedule as Admin); the Planner's own back link says "Change day", since on phones the top bar's Back sits above it and leaves the screen. No migration.
- [ ] **Stop times (`feat/stop-times`, 2026-10-09)**: between Start and End trip the Driver taps Arrived and Leaving at each stop (`stop_taps`, 0045); with Start/End these are the actual Time Out / Time In printed on the form. Destinations get an optional location on Request choices (`destination_locations`, 0044) to check the taps against. After submit an Admin fills in or corrects a time on Finished Trips (`trip_time_corrections`, `set_trip_time`, 0046), and `mark_completion_done` refuses while any is missing. Attendance gets a Stops column. Complete trip opens as soon as End trip is tapped, even before the last planned Time In (0047). Demo data: `scripts/seed-stop-times-demo.mjs` (local only; driver3 on UAT-003). **Sent as a PR** after the owner walked the flow locally (2026-10-09). Also on the branch: Drivers see simple trip cards (one big button), the Planner is decluttered (Leg 1 only to start, no request pool panel, send back at Submit), one trip per vehicle per day (0048), typed "Other" destinations/purposes become choices (0049), and the Admin screens check stop taps against each place's current location. Migrations 0044–0049 to apply to production after merge.
- [x] **One trip per vehicle per day (owner's request, 2026-10-09; done on `feat/stop-times`, migration 0048)**: once a vehicle has a schedule on a day, it shouldn't be offered for another schedule that day. Today `schedule_reservations` only refuses overlapping *times* (`schedule_reservations_vehicle_overlap`), so a vehicle (and its Driver) can take a morning and an afternoon trip the same day. Decided with the owner: a cancelled (or discarded) schedule frees the vehicle for that day again; no day has two trips on one vehicle yet, so nothing to migrate. Enforce in Postgres (not only the Planner's vehicle list) and grey the vehicle out in the Planner with the reason.
- [x] **UI refresh (`feat/ui-refresh`, 2026-10-05)**: logo-based colors with status colors for success/warning/error/info, a sidebar in place of the home-button navigation, a dashboard with stat tiles, and a restyle of every screen and the sign-in page (see `docs/DESIGN.md`). Reviewed by the owner and sent as a PR.
- [ ] **Company Trip flow and new request forms (`feat/requester-vehicle`, 2026-10-14)**: built in nine phases from the owner's prototypes; decisions in `docs/MEMORY.md` "Company Trip flow and request groups". Admin setup (Position, Can request company trips, Driver type, a Company car Driver's request switches, vehicles that can be requested for company trips, six new choice lists; 0051); request groups with one request per stop, Urgent per stop with a reason, Details, how flexible each stop is (0052); moving an "any day that week" stop (0053); the new Daily and Company Trip forms; the Daily Planner's "Requests for this day" panel; the Company trip planner at `/schedules/company` (0054); My Trips, where the requester records a Company trip (0055, 0056); the Finished Trips Form filter and the Company Trip Form print. e2e: `daily-request.spec.ts`, `company-trip.spec.ts`; `seed-uat.mjs` adds the Company setup. **Not pushed yet; waiting for the owner's whole-flow test.** Migrations 0050–0056 to apply to production after the PR merges. Known gaps are listed in MEMORY.
- [ ] **Scheduling page (`feat/scheduling-page`, stacked on `feat/requester-vehicle`, 2026-10-15)**: one page for Daily and Company trips from the "KOVA Scheduler" prototype; it replaced Create schedule and the Company trip planner (old addresses redirect; their code and CSS deleted). Changing a trip waiting for the Admin takes it back to a draft (0057). Warnings block Submit; Undo; Time Out carries Time In. Help text, the three planning e2e specs, PRD, RULES, ARCHITECTURE, DESIGN and MEMORY updated; decisions in `docs/MEMORY.md` "Scheduling page". **Not pushed yet.** Still to do: run the full pgTAP suite on a fresh database, the owner's whole-flow click-through, then the PR; migrations 0050–0057 to production after merge.
- [ ] **`docs/PRD.md`, `RULES.md` and `DESIGN.md` have not been reviewed by KOVA's operators.** They were written from the code and the schema; treat them as a first draft to correct.
- [ ] **`docs/PRD.md` acceptance criteria and success metrics are drafts.** They need stakeholder review, and every metric target is still blank (set them from the pilot week's baseline). See `docs/MEMORY.md` "Open questions".
- [ ] **Notification icons (owner's request, 2026-10-15; `feat/notification-icons`, stacked on `feat/scheduling-page`)**: each type of notification in the bell has its own icon in a badge of its status color. Waiting for the owner's test; not pushed.

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

# KOVA v2.0 — Phase 0 baseline (2026-09-24)

Everything below was verified directly against this repository's code,
migrations, and local build/test tooling on branch
`docs/rename-v1_3-to-v2_0` (commit `7cd5c01`). Where something could not be
independently verified this session (Vercel project settings, live
Supabase project state), it is marked **unverified** rather than assumed.

## 1. Environment map

| Item | Value | How verified |
|---|---|---|
| Git remote | `github.com/zylestial/kc-kova` (private) | `git remote -v` |
| Default/production branch | `master` (`origin/HEAD -> origin/master`) | `git branch -a` |
| Local `.vercel` link | Not present locally | `ls .vercel` — gitignored, never linked in this working copy |
| Vercel CLI | Not installed locally; `npx vercel` requires an install this session didn't perform | attempted `npx vercel whoami` |
| **Vercel project name/production branch/env-var scopes** | **Unverified this session** — `docs/archive/MEMORY-history.md` records a prior session's claim of project `kc-kova` tracking `master`, but this session has no dashboard/CLI access to confirm it independently | not verifiable without Vercel credentials |
| Database provider | Supabase (Postgres + Auth + RLS + RPC) | `supabase/` folder, `lib/supabase/*`, `ARCHITECTURE.md` |
| **Live Supabase project ref** | **Unverified this session** — `docs/archive/MEMORY-history.md` records project `kc-kova` (`rhzqdtgruhpdhopkksuf`) from a prior deployment, not re-confirmed here | `.env.local` exists but was not read (contains real secrets per repo convention) |
| CI | GitHub Actions, `.github/workflows/ci.yml`: `pnpm install --frozen-lockfile` → `tsc --noEmit` → `lint` → `test` → `build`, on push/PR to `main`/`master` | read directly |
| Git tags | **None exist** (`git tag` empty) — so no `v1.2-stable` tag yet; Phase 1 starts from a clean slate here | `git tag` |
| Branches present | `master`, `docs/rename-v1_3-to-v2_0` (current), plus several stale local/remote feature and dependabot branches (see §4) | `git branch -a` |

## 2. Verified backend capabilities

Each item below was confirmed by reading the actual implementing code, not
assumed from docs.

| Reported capability | Verified | Evidence |
|---|---|---|
| `POST /api/bookings` + `create_booking` RPC | Yes, current signature takes date/plate/hours/destination/purpose/notes/bookingType/urgentReason — **no `driverId` param**; Driver is derived server-side from the vehicle's `assigned_driver_id` | `supabase/migrations/0012_vehicle_driver_assignment.sql` lines 152–235; route wraps it in `app/api/bookings/route.ts` |
| Booking slots + vehicle/Driver conflict constraints | Yes — `booking_slots (date, plate, hour)` and `(date, driver_id, hour)` unique indexes are the actual conflict mechanism, populated only on `approve_booking`, not on create (bookings are created `PENDING` and hold no slots) | `0001_init.sql` lines 83–91; `0011_booking_type_and_approval.sql` lines 326–353 |
| Same-vehicle/same-day Driver trigger | Yes, `enforce_same_daily_driver` | `0001_init.sql` lines 104–127 |
| `cancel_booking` + soft cancellation | Yes — sets `status = 'CANCELLED'`, deletes `booking_slots`, row never deleted | `0011_booking_type_and_approval.sql` lines 247–286 |
| `PUT /api/records/:recordId`, submission locks, history, Done locking | Yes — Driver locked out once `submittedAt` is set; Admin locked out once `status = DONE`; every Admin edit/Mark-as-Done appends an immutable history entry; `submittedAt` is never trusted from the client, always server-set once | `app/api/records/[recordId]/route.ts` (full file read) |
| RLS, service-role usage, account roles | Yes — every table has RLS enabled; `bookings`/`booking_slots`/`vehicle_records` grant **no** direct write policies to any role (writes only via `security definer` RPCs or, for `vehicle_records`, the service-role client with hand-written checks); role enum is currently `('Booker', 'Driver', 'Admin')` — **no `Scheduler` role exists yet** | `0001_init.sql` line 13; `0007_rls_policies_per_operation.sql` |
| Print component (Daily Vehicle Record) | Yes — lives inside `app/scheduler.tsx` (1,065 lines), not a separately named component: Driver-facing leg entry (`Leg` type, up to 8 legs, ANONANG round-trip validation) and the Admin/print view (`@media print` table rendering, `NO. OF TRIP LEGS`) are both in this one file | `app/scheduler.tsx` lines 42–97, 600–1030 |

**A capability the plan describes as already built is only partially
true**: v1.2 already has a Booker→Admin **approval** flow (`PENDING` →
`approve_booking`/`deny_booking`, `0011_booking_type_and_approval.sql`) —
but this is structurally different from the v2 target (Requester submits a
date-only request with no vehicle/time → Scheduler builds a multi-leg Trip
Record → Admin approves). See conflict #1 below.

## 3. Role/access matrix — current v1.2 (as-built, not the v2 target)

| Role | Enum value | Can do today |
|---|---|---|
| Booker | `Booker` | Create/edit/cancel own bookings (date + vehicle + time + destination + purpose, single destination per booking); sees only own bookings/records |
| Driver | `Driver` | Views own bookings; fills the Daily Vehicle Record (legs, odometers) for a vehicle/day; cannot create bookings |
| Admin | `Admin` | Everything a Booker can plus: manage accounts/vehicles/booking-options/people; approve/deny `PENDING` bookings; edit/finalize submitted records; mark Done |

No `Scheduler` or `Requester` role/menu/permission exists anywhere in
code, migrations, or RLS today — both are net-new, not renames of existing
scaffolding (see conflict #2).

## 4. Build/test baseline

All four gates specified by the plan and `docs/RULES.md` pass clean on the
current branch:

| Check | Result |
|---|---|
| `pnpm exec tsc --noEmit` | Clean, zero errors |
| `pnpm lint` | Clean — 2 pre-existing `@next/next/no-img-element` warnings only (`app/kova-brand.tsx`, `app/scheduler.tsx`), 0 errors |
| `pnpm test` (vitest) | 62/62 tests pass across 5 files |
| `pnpm build` (`next build`) | Compiles successfully, 10 static/dynamic routes generated, no errors |

No known failures exist on this branch as of this baseline.

## 5. Cleanup inventory (candidates only — nothing removed)

Per the plan, this is an audit for later approval, not a deletion pass.

### Likely-safe candidates (backed by a grep-verified zero-reference check)

- **~46 of the 61 vendored `components/ui/*.tsx` shadcn scaffold files are
  never imported by any `app/*.tsx` screen**, including entire unused
  subsystems: chat-widget scaffolding (`bubble.tsx`, `message.tsx`,
  `message-scroller.tsx`, `attachment.tsx`), a full data-viz component
  (`chart.tsx`), and common primitives this app simply doesn't use
  (`badge.tsx`, `avatar.tsx`, `card.tsx`, `table.tsx`, `calendar.tsx`,
  `command.tsx`, `combobox.tsx`, `carousel.tsx`, `drawer.tsx`, `sidebar.tsx`,
  `form.tsx`, and ~30 more — full list available on request). Verified via
  a per-file grep for `components/ui/<name>` across `app/`; the ~15 that
  **are** used (`button`, `dialog`, `alert-dialog`, `select`, `input`,
  `textarea`, `checkbox`, etc.) were confirmed actually imported.
- **Six npm dependencies exist only to back those unused components**:
  `recharts` (chart.tsx), `embla-carousel-react` (carousel.tsx), `vaul`
  (drawer.tsx), `cmdk` (command.tsx), `input-otp` (input-otp.tsx),
  `react-resizable-panels` (resizable.tsx) — each imported in exactly one
  file, and that file is itself unused by any screen.
- **Stale remote branches** already merged or superseded: `origin/audit/
  mobile-booker-approval-flow`, `origin/chore/audit-and-cleanup`,
  `origin/chore/phase-4-final-verification`, `origin/feature/csp-header`,
  `origin/feature/favicon` — need a merged-status check before removal
  (not done this session; removing remote branches is also a shared-state
  change requiring separate confirmation, not just a Phase-0 note).
- Several open Dependabot PR branches (`react`, `next`, `tailwindcss`,
  `typescript`, `recharts`, etc.) — routine, not v2-related; leave for
  normal dependency review.

### Needs your decision (not a clear-cut removal)

- `tsconfig.tsbuildinfo` (472 KB) is gitignored but present in the working
  tree — build artifact, not a repo cleanup item, safe to ignore/regenerate.
- `vendor/shadcn-tailwind-4.13.0.css` + its license file — used by
  `app/globals.css`(likely) or `postcss` config; needs a one-line
  confirmation it's actually `@import`-ed before flagging as unused (not
  checked yet — low priority, small file).

**Nothing here is proposed for deletion in Phase 0.** Actual removal, if
approved, happens in the phase whose replacement makes it safe (mainly
Phase 3–5, once the new schema/screens exist and the old
booking-flow/scheduler UI is superseded).

## 6. Conflicts and decisions needed before later phases

These don't block Phase 0 or Phase 1 (git/branch setup), but Phase 3–5
cannot proceed without your call on them.

### Conflict 1 — the "approval" flow already in v1.2 vs. the v2 workflow

v1.2 already ships a `PENDING → approve_booking/deny_booking` Admin
approval step (migration `0011`, shipped and in UAT). But it approves a
**Booker-chosen vehicle+time+single-destination booking**, not a
**Scheduler-built multi-destination Trip Record** the way v2 requires.
Concretely: today, one `bookings` row = one destination, one vehicle, one
time slot, chosen by the person creating the request. v2 wants: a
Requester picks only a **date** (no vehicle, no time, one-or-more
destinations), and a separate Scheduler role later assigns the vehicle and
builds an ordered multi-leg Trip Record from a pool of such requests.

**This means the existing `bookings`/`booking_slots`/`approve_booking`
machinery cannot simply be relabeled — it needs a new `requests` +
`schedules` + `schedule_revisions` data model on top of/replacing it**,
per the plan's Phase 3 table. Options:
1. Keep `bookings`/`booking_slots` as the internal reservation/conflict
   primitive that a `SCHEDULED` Trip Record's legs write into, and add the
   new `requests`/`schedules` layer on top — reservation semantics reused,
   request/approval semantics rebuilt.
2. Replace `bookings` outright with the new model and migrate historical
   rows into it.

Recommendation: (1) — it reuses the one part of the current schema
(`booking_slots`' unique-index conflict guarantee) that's genuinely hard to
get right, and treats the request/approval layer as legitimately new
rather than a renamed version of something that doesn't structurally match.
This is a Phase 3 design decision, not something to resolve now — flagging
it here because it changes how big Phase 3 actually is.

### Conflict 2 — Scheduler is a new role, not a rename

The plan's "Full Requester role migration" section describes migrating the
existing request-creation role (`Booker`) to `requester`. That inventory
work applies cleanly. But **`Scheduler` has no existing counterpart at
all** — it's pure net-new role, permissions, and screens, not a rename.
Worth calling out so Phase 3's scope estimate doesn't undercount it as
"just enum work" alongside the Requester rename.

### Conflict 3 — "Trip leg buttons" is already an open v1.2 task that overlaps Phase 5/9

`docs/archive/TASKS-history.md`'s v1.2 backlog has an unbuilt item, **"Trip leg buttons and
final return"**, that reworks the exact same leg-entry UI (`Add Leg`/`Add
Final Leg` buttons, ANONANG start/end validation) that v2 Phase 5's Trip
Record and Phase 9's printing also touch. Recommendation: fold that v1.2
backlog item into the v2 Phase 5/9 work rather than building it twice —
confirm you're OK dropping it as a standalone v1.2 item once v2 Phase 5
starts, since v2's Trip Record supersedes it.

### Conflict 4 — existing production/UAT data has no `Scheduler`-created schedules by construction

Because Scheduler doesn't exist yet, **every historical `bookings` row was
effectively both "requested" and "scheduled" by the same Booker/Admin
action** — there is no historical Scheduler to backfill. Phase 10's
migration rehearsal will need an explicit rule for what synthetic
Scheduler/version metadata (if any) backfilled records get — the plan
already says "do not invent Scheduler creators... for legacy records," so
the likely answer is: legacy bookings backfill into v2 as already-published
schedules with no Scheduler attribution, flagged as legacy-origin. Needs
your confirmation before Phase 10, not now.

## 7. Requester role migration — full inventory (Phase 3 input)

Every file referencing the current `Booker` role value, confirmed by
direct search (23 files):

- **Migrations**: `0001_init.sql` (role check constraint), `0002`, `0006`,
  `0007`, `0010`, `0011`, `0012_vehicle_driver_assignment.sql` (role checks
  inside `create_booking`/`update_booking`/RLS policies)
- **API routes**: `app/api/records/[recordId]/route.ts`,
  `app/api/accounts/route.ts`, `app/api/accounts/[accountId]/route.ts`
- **Frontend**: `app/scheduler.tsx`, `app/settings.tsx`, `app/page.tsx`
- **Shared lib**: `lib/kova-api.ts` (types, role-gated helpers)
- **Tests**: `lib/kova-api.test.ts`, `lib/supabase/accounts.test.ts`
- **Docs**: `docs/TASKS.md`, `docs/QA_ROLE_TESTS.md`, `docs/PRD.md`,
  `docs/RULES.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE.md`,
  `BACKEND_INTEGRATION.md`

No stale sessions/claims exist to invalidate yet (nothing renamed so far).
This list is the concrete scope for Phase 3's "inventory every use of the
previous request-creation role" step.

## Gate check

- Live code and database identified: code confirmed directly; **Vercel
  project settings and the live Supabase project's actual current state
  are not independently verified this session** — carry this into Phase 1/2
  as an open verification step, ideally with you providing dashboard
  access or confirming the values already recorded in `docs/archive/MEMORY-history.md`
  are still current.
- No production data or live traffic was touched. No migrations were run.
  No files were deleted.
- Migration risk identified without changing production: yes — see §6.

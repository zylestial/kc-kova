# KOVA — System Design

This is the UI/UX design reference: screens, navigation, visual language,
and interaction patterns. For the Supabase data model and API contract, see
`docs/ARCHITECTURE.md`.

## Design tokens

Defined as CSS custom properties in `app/globals.css`, built on shadcn's
"new-york" style + Tailwind CSS 4 + Radix UI (`components.json`):

| Token | Value | Used for |
| --- | --- | --- |
| `--background` | `#f4f6fa` | Page background |
| `--foreground` | `#111827` | Primary text (logo black) |
| `--card` | `#fff` | Panel/card surfaces |
| `--primary` | `#2b47a8` | Primary actions, links, active states (logo blue) |
| `--primary-hover` | `#22398a` | Hover on primary actions |
| `--secondary`, `--muted` | `#eef1f8` | Secondary surfaces, muted backgrounds |
| `--accent` | `#eaeefb` | Highlighted/selected backgrounds |
| `--destructive` | `#c62f2f` | Destructive actions |
| `--border`, `--input` | `#e1e6ef`, `#d6dce8` | Borders and form field outlines |
| `--ring` | `#2b47a8` | Focus rings |
| `--radius` | `.5rem` (steps `sm` 6px, `md` 8px, `lg` 12px, `xl` 16px) | Corner rounding |

Brand colors are taken from the Kayelen's Construction logo:
`--brand-blue` `#2b47a8` (gears, hammer), `--brand-navy` `#1b2e6e`
(dark surfaces such as the sidebar), `--brand-green` `#3b5228` (gears;
small accents only) and `--steel` `#6b7280` (nails; secondary text).

### Status colors

Every status has a solid color plus a light background, border and text
color for tinted surfaces (pills, banners, inline messages). Use these
instead of hand-typed hex values. The text color is at least 5.4:1 on its
background.

| Status | Solid | `-bg` | `-border` | `-fg` | Used for |
| --- | --- | --- | --- | --- | --- |
| `--success` | `#2e8b4e` | `#eaf5ee` | `#bfe3cb` | `#1e6b3a` | Scheduled, done, saved |
| `--warning` | `#e0a100` | `#fff6db` | `#f5d98a` | `#8a5a00` | Pending, leg warnings, unsaved changes |
| `--error` | `#c62f2f` | `#fdecec` | `#f3c2c2` | `#a12c2c` | Rejected, failures, form errors |
| `--info` | `#2f6fe0` | `#eaf1ff` | `#c3d5fa` | `#1f4fa8` | Notices and tips, upcoming trips |
| `--neutral` | `#6b7280` | `#f1f3f6` | `#dde2e8` | `#4b5563` | Cancelled, inactive |

Each is also a Tailwind color (`bg-warning-bg`, `text-error-fg`, ...).

Typography is Inter (falling back to Arial/Helvetica) at a 16px base.
`components/ui/` holds the vendored shadcn/Radix primitives — per
`docs/ARCHITECTURE.md`, these aren't hand-edited; screen-specific styling
lives in `app/globals.css` instead, scoped by class name per screen (e.g.
`.booking-flow`, `.driver-trip-table`, `.settings-shell`).

## App shell and dashboard

Signed-in screens sit in `app/(app)/layout.tsx`:

- **Sidebar** (`app/(app)/sidebar.tsx`): navy (`--brand-navy`), 256px,
  fixed on the left from 1024px up; below that it's a drawer opened from
  the top bar's menu button and closed by the scrim, the X or Escape. It
  holds the logo, the role's menu (`navItems()` in
  `app/(app)/nav-items.ts`, with the longest matching path highlighted),
  Help, the account and Sign out. Menu links are real links, but a plain
  click goes through `leave()` so unsaved work still asks first. While an
  Admin is viewing as another role, the menu is that role's.
- **Top bar** (`app/(app)/topbar.tsx`): today's date (wide screens) or
  the menu button and logo (narrow), the refresh-failed warning, Refresh
  and notifications.
- **Dashboard** (`/home`): a navy welcome banner, stat tiles from
  `homeStats()` (`lib/home-stats.ts`) and the quick-action cards. A tile
  takes its status color only when its count is above zero; a zero is
  neutral grey. A tile opens its screen filtered to what it counts, through
  query parameters the screen reads once and strips (`/schedules?status=`
  and `?view=`, `/requests?progress=`, `/finished?status=` and
  `?problems=`); "Cancellation requests" jumps to `/schedules#cancellations`.
- **Schedules has Day, Week and All dates views.** All dates lists every
  matching schedule with its date on each card; a status link with no view
  opens it, so the list shows everything the tile counted. Picking a date
  switches back to Day.
- Screens no longer have a "← Home" back button; the sidebar replaces it.
  The Planner keeps "← Schedules" when editing an existing schedule.
  Below 1024px the top bar shows **← Back** (in place of the logo) on every
  screen but the Dashboard: it goes to the previous screen visited in the
  app, or the Dashboard when the page was opened directly, through
  `leave()`.
- **Done trips leave the working lists.** Once an Admin marks a trip Done
  it no longer shows on Schedules or the Driver's My Schedule, only on
  Finished Trips (`finishState()` in `lib/trip-finish.ts`). A trip waiting
  for review stays. Schedules lists each day's pending schedules (draft,
  returned, submitted) before approved ones, each by start time; My Schedule
  lists trips still to complete before those waiting for review, each by
  date.
- **Schedulers have a read-only Finished Trips.** RLS doesn't let them read
  `trip_completions`, so the list comes from request progress (`COMPLETED`
  / `DONE`, which `request_progress_of` derives from the completion) and has
  no odometer or distance.
- Fixed bottom bars (`.booking-bottom`) start after the sidebar on wide
  screens.

Each role has its own accent, set on `<html data-role>` by `AccountProvider`
(the viewed role during Admin "View as"). It colors the sidebar, the
dashboard banner, the active menu item, eyebrows, quick-action icons and
card hover. Buttons, links and status colors are the same for every role.
All pass 4.5:1 for their text.

| Role | Sidebar/banner | Accent |
| --- | --- | --- |
| Admin | `#22398a` → `#1b2e6e` (logo navy) | `#2b47a8` |
| Scheduler | `#5b3fb0` → `#33236e` (violet) | `#5b3fb0` |
| Driver | `#4a6633` → `#2c3d1f` (logo green) | `#3f5a2b` |
| Requester | `#136f7c` → `#0b4650` (teal) | `#11697a` |

Cards and panels use 16px corners and `--shadow-card`; status pills carry a
dot in their text color. The UI font is Inter (`next/font/google`,
self-hosted at build time as `--font-inter`); printouts keep Arial.

## Responsive breakpoints

Consistently used across `app/globals.css`: `850px`, `700px`/`650px`,
`600px`, and `480px`, each narrowing grid layouts (e.g. a 3- or 4-column
stat/field grid collapses toward 1 column) and hiding secondary chrome
(workspace label, panel-foot detail) as width decreases.

## Print layout

The Daily Vehicle Trip & Utilization Form has a dedicated `@media print`
stylesheet (`app/globals.css`) that renders a fixed A4-portrait official
form: company header/logo, info grid, route and recording rule, an eight-row
trip table with Name/Sign lines, the final return and full-tank block,
vehicle control, the PM/COO approval block, Finance use and submission
control. It is printed from a finished trip in Admin Finished Trips
(`app/finished-trip-print.tsx`), which fills in what v2 knows (route,
planned times, Driver, odometers, submission date) and leaves signatures,
fuel checks and Finance fields blank for handwriting. The form is rendered
into `document.body` as a portal, because `.app-shell{display:none!important}`
hides the app chrome and dialogs are hidden in print, so `.print-form` is the
only thing shown. This is a core, distinctive feature of the Admin review
workflow, not an incidental print stylesheet.

## Empty and focus states (verified)

- A shared "empty" pattern (icon + heading + paragraph, class `.empty`)
  is used for zero-results states, e.g. the Schedule panel when a date has
  no bookings.
- `.booking-flow button:focus-visible` sets an explicit `3px` outline —
  confirmed keyboard-focus styling exists on at least the booking flow.

## Button loading/disabled states (verified, v2.2)

Every button that triggers a mutating API call (Submit request, Save
draft/Continue, Approve/Return, Sign In, cancellation confirm/decline,
Driver trip completion/problem report, account/vehicle save, password
change, booking-options save) follows the same convention: a local
`busy` (or route-specific, e.g. `signingIn`) boolean state, set before
the call and cleared in a `finally`, drives both `disabled={busy}` and
a label swap (e.g. `{busy ? "Saving…" : "Save"}`). This prevents
double-submits and gives visible feedback while a request is in
flight, and was confirmed consistent app-wide during the v2.2 UX pass
rather than assumed. Non-mutating buttons that only open a dialog or
switch local view state don't need this pattern.

**Not yet audited**, and deliberately left undocumented rather than
guessed at: form-validation error presentation (`react-hook-form`/
`zod` are dependencies but their usage wasn't traced screen-by-screen),
and a systematic accessibility pass beyond the one confirmed
focus-visible rule and the one outstanding `<img>`/`next/image` lint
warning (the only one `pnpm lint` reports). Treat this section as a starting point,
not a complete audit.

## UI structure

`app/page.tsx` is the app shell: it holds sign-in, session restore, and a
simple `Screen` state machine that swaps between full-screen views — no
router/URL segments are used for in-app navigation.

| Screen | Component | Shown to |
| --- | --- | --- |
| `*-home` | home buttons in `app/page.tsx` | All roles |
| `new-request` | `app/request-flow.tsx` | Requester, Admin |
| `my-requests` | `app/my-requests.tsx` | Requester, Admin |
| `create-schedule` | `app/schedule-planner.tsx` | Scheduler |
| `schedules` | `app/schedules.tsx` | Scheduler, Admin (review) |
| `my-schedule` | `app/driver-schedules.tsx` (a Driver's trips grouped Today / This week / This month / Other trips; an Admin viewing as Driver gets filters instead; Start trip / End trip, each tap's distance, margin and coordinates; then Complete trip) | Driver |
| `attendance` | `app/admin-attendance.tsx` (Start/End taps per trip; away from base, no location and late taps flagged in warning color; places link to Google Maps, with the exact coordinates and the phone's ± accuracy below) | Admin |
| `finished` | `app/driver-finished-trips.tsx` (Driver), `app/admin-finished-trips.tsx` (Admin) | Driver, Admin |
| `settings` | `app/settings.tsx` | Admin (accounts, vehicles, booking options) |
| — | `app/booking-options.tsx` | Admin (projects/destinations/purposes/people) |

The Planner (`app/schedule-planner.tsx`) holds the state and the save, submit,
discard and send-back logic, and composes its screen from `app/planner/`: day
picker, request pool, existing commitments, vehicle panel, one `LegCard` per
leg, the checklist, and the submit, send-back, discard and remove-leg
dialogs. Those parts only show what they're given and call back; they hold no
state of their own.

The v1 screens (Schedule grid, booking flow, Booking Approvals, Daily Vehicle
Record editor, review and history viewers) were removed with migration 0032.

All screens are client components (`"use client"`) that read/write through
`lib/kova-api.ts`'s in-memory cache, refreshed by re-calling
`hydrateKovaData()` (a fresh `GET /api/bootstrap`) after every mutating
call. Screens read it with the `useKovaData()` hook (`lib/use-kova-data.ts`,
built on `useSyncExternalStore`), which re-renders them whenever the cache is
replaced; derive lists from it with `useMemo` rather than copying them into
state. A screen that must hold a snapshot (the Planner's schedule being
edited) reads `getSchedules()`/`getRequests()` once instead.

## Sorting tables (2026-10-08)

Every trip table (My Schedule, Attendance, the three Finished Trips screens)
has sortable column headings (`app/sortable-head.tsx`, `lib/table-sort.ts`):
click once for ascending, again for descending, a third time for the screen's
own default order. Phones hide table headings (stacked tables), so the filter
row there gets a "Sort by" picker with the same choices. Schedules shows
cards, not a table, so its Sort by picker shows on every screen size; the
Week view keeps its days and sorts within each. Sorts are not remembered
between visits.

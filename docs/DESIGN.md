# KOVA — System Design

This is the UI/UX design reference: screens, navigation, visual language,
and interaction patterns. For the Supabase data model and API contract, see
`docs/ARCHITECTURE.md`.

## Design tokens

Defined as CSS custom properties in `app/globals.css`, built on shadcn's
"new-york" style + Tailwind CSS 4 + Radix UI (`components.json`):

| Token | Value | Used for |
| --- | --- | --- |
| `--background` | `#f4f6f9` | Page background |
| `--foreground` | `#16243a` | Primary text |
| `--card` | `#fff` | Panel/card surfaces |
| `--primary` | `#2357d9` | Primary actions, links, active states |
| `--secondary`, `--muted` | `#edf1f7` | Secondary surfaces, muted backgrounds |
| `--accent` | `#eaf0ff` | Highlighted/selected backgrounds |
| `--destructive` | `#bd3131` | Destructive actions, error text |
| `--border`, `--input` | `#dfe5ed`, `#d7dfea` | Borders and form field outlines |
| `--ring` | `#2357d9` | Focus rings |
| `--radius` | `.5rem` (with `sm`/`md`/`lg`/`xl` steps) | Corner rounding |

Typography is system sans (`Arial, Helvetica, sans-serif`) at a 16px base.
`components/ui/` holds the vendored shadcn/Radix primitives — per
`docs/ARCHITECTURE.md`, these aren't hand-edited; screen-specific styling
lives in `app/globals.css` instead, scoped by class name per screen (e.g.
`.booking-flow`, `.driver-trip-table`, `.settings-shell`).

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

**Not yet audited**, and deliberately left undocumented rather than
guessed at: loading-state behavior during `hydrateKovaData()` calls,
form-validation error presentation (`react-hook-form`/`zod` are
dependencies but their usage wasn't traced screen-by-screen), and a
systematic accessibility pass beyond the one confirmed focus-visible rule
and the one outstanding `<img>`/`next/image` lint warning (see
`docs/TASKS.md`). Treat this section as a starting point, not a complete
audit.

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
| `my-schedule` | `app/driver-schedules.tsx` | Driver |
| `finished` | `app/driver-finished-trips.tsx` (Driver), `app/admin-finished-trips.tsx` (Admin) | Driver, Admin |
| `settings` | `app/settings.tsx` | Admin (accounts, vehicles, booking options) |
| — | `app/booking-options.tsx` | Admin (projects/destinations/purposes/people) |

The v1 screens (Schedule grid, booking flow, Booking Approvals, Daily Vehicle
Record editor, review and history viewers) were removed with migration 0032.

All screens are client components (`"use client"`) that read/write through
`lib/kova-api.ts`'s in-memory cache, refreshed by re-calling
`hydrateKovaData()` (a fresh `GET /api/bootstrap`) after every mutating
call, and by listening for the `kova-data-update` window event.

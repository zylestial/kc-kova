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

The app icon is three gears drawn as vector paths in `public/favicon.svg`
(blue and green from the logo). The PNG icons (`icon-192`, `icon-512`,
`icon-maskable-512`, `apple-touch-icon`) are rendered from it on white; the
maskable one keeps the gears inside the 80% safe circle.

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
  holds the logo (the navy version, `public/images/kova-sidebar-logo.png`,
  straight on the sidebar with no white box; kept clear of the X in the
  drawer) and the KOVA name with no subtitle, the role's menu (`navItems()` in
  `app/(app)/nav-items.ts`, with the longest matching path highlighted),
  Help, and the account
  card: its name and avatar open My account (no separate menu item, to
  keep the menu short), and its icon signs out. Menu links are real links, but a plain
  click goes through `leave()` so unsaved work still asks first. While an
  Admin is viewing as another role, the menu is that role's.
- **Top bar** (`app/(app)/topbar.tsx`): today's date (wide screens) or
  the menu button and logo (narrow), the refresh-failed warning, Refresh
  and notifications. Each notification in the bell has an icon for its
  type in a round badge of its status color (`notificationIcons` in
  `app/notification-bell.tsx`): green for good news (scheduled, trip
  published), blue for news (submitted, moved, split), amber for something
  to look at (sent back, returned, cancellation asked or declined), red for
  something wrong (cancelled, problem reported). A new type won't compile
  until it has one. Clicking one closes the bell and opens the exact item
  (`notificationTarget`, `lib/notification-target.ts`, which a phone
  notification's tap uses too): the request's details, the trip on My Schedule
  or Finished Trips, a submitted schedule's details over its week, a
  returned trip's vehicle on Scheduling (`?trip=`, opened, scrolled to and
  highlighted), or a cancellation request's row on Schedules
  (`?cancellation=`, highlighted). When push is set up, the bell's last
  row (sticky at the bottom) is **Push notifications** with this device's
  state: **Turn on** right there when it's off, **Manage** (the dialog)
  when it's on, or **How to** (the dialog) when the device can't yet.
- **Push notifications** dialog (`app/push-dialog.tsx`, from the bell):
  one line saying where this device stands (on, off, blocked in the
  browser, can't, or, on an iPhone or iPad not opened from the Home
  Screen, how to add it there first), with **Turn on**, or **Turn off**
  and **Send a test** (to this device only). It's per device, so the copy says to turn it on on
  each phone or computer. A phone notification reads "KOVA" over the
  bell's text, with the app icon.
- **Dashboard** (`/home`): a navy welcome banner, stat tiles from
  `homeStats()` (`lib/home-stats.ts`) and the quick-action cards. A tile
  takes its status color only when its count is above zero; a zero is
  neutral grey. Each tile has its own icon for what it counts (the bell's
  icon for that event where there is one), not one per color, so two
  warning tiles side by side still look different. A tile opens its screen
  filtered to what it counts, through
  query parameters the screen reads once and strips (`/schedules?status=`
  and `?view=`, `/requests?progress=`, `/finished?status=` and
  `?problems=`); "Cancellation requests" jumps to `/schedules#cancellations`.
- **Form filter: Daily Vehicle Trips / Company Trips** (`app/form-filter.tsx`,
  2026-10-15) on Schedules, Finished Trips (Admin and Scheduler), My
  Schedule (an Admin viewing as Driver; a Driver only when they have both
  kinds of trip, next to Sort) and My requests (only when the account has
  Company requests).
- **Schedules has Day, Week and All dates views.** All dates lists every
  matching schedule with its date on each card; a status link with no view
  opens it, so the list shows everything the tile counted. Picking a date
  switches back to Day. Week cards show the plate only. On phones the
  filters fold behind a "Filters" button (with a count of those set), and
  an empty day in the week is one line.
- Screens no longer have a "← Home" back button; the sidebar replaces it.
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
- **Filter rows fold on phones.** Below 700px a filter row (`FilterFold`,
  `app/filter-fold.tsx`) sits behind a "Filters" button showing how many
  filters are set, so the records come first. Wider screens always show
  the row. A row holding only Sort by doesn't fold.

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
| Finance | `#8a5410` → `#55330a` (amber) | `#8a5410` |

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
actual times from the Driver's taps or an Admin's entries, Driver, odometers,
submission date) and leaves signatures, unrecorded times,
fuel checks and Finance fields blank for handwriting. The form is rendered
into `document.body` as a portal, because `.app-shell{display:none!important}`
hides the app chrome and dialogs are hidden in print, so `.print-form` is the
only thing shown. This is a core, distinctive feature of the Admin review
workflow, not an incidental print stylesheet.

A Company trip prints the **Company Trip Form** instead
(`app/company-trip-paper.tsx`, filled by `app/company-trip-print.tsx`, from
the "KOVA Company Trip Flow" prototype): company header, an info grid (date,
vehicle, plate, Driver, requested by, Position, department / site, both
odometers, total distance, number of legs), the route and recording rule,
an eight-row trip record (requester, purpose and details, leg, origin, Time
Out, destination, Time In, site officer / supplier / contact), the
signatories (requested by, Immediate Supervisor, site officer / supplier,
PM / CM / Dept. Head) with blank signature lines, and For Finance Use. It
uses the same portal and `.print-form`, inside `.company-print`. It only
appears when an Admin prints; the request form shows no preview.

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
| `new-request` | `app/request-screen.tsx` with `app/request-form.tsx` (New Request prototype: a Daily / Company Trip choice for accounts allowed both; a date strip with Jump to date; one project or a different one per stop; stop cards, each Regular / Urgent with a reason, destination, purpose, Details, how flexible (any time that day / fixed time / any day that week), contact, and on a Company Trip a supplier; the Company Trip's fields and a printed form preview; a summary panel; also used to edit) | Requester, Admin, allowed Drivers |
| `my-requests` | `app/my-requests.tsx` (one row per stop, numbered 52-A; details show the request's other stops and the Company Trip's fields) | Requester, Admin, allowed Drivers |
| `my-trips` | `app/my-trips.tsx` (the requester's approved Company trips as folding cards: the steps in route order with their times, one big button for the next (Start trip at …, Arrived at …, Leaving …, Arrived at … · End trip), an odometer field on Start and End trip, the distance once ended; the same "Problem here?" stop report, hold and Scheduler's answer as the Driver) | Requesters with Company trips |
| `scheduling` | `app/scheduling.tsx` with `app/scheduler/` at `/scheduling` (see below) | Scheduler |
| `schedules` | `app/schedules.tsx` | Scheduler, Admin (review), Finance (view only) |
| `my-schedule` | `app/driver-schedules.tsx` (a Driver's trips in separate cards: Today / This week / This month / Other trips; an Admin viewing as Driver gets filters instead; the trip as cards (`app/driver-trip-steps.tsx`), one per place in route order: Start at ANONANG, each stop (name, purpose, contact with a call link), Back to ANONANG; inside each, Arrived / Left ticked with their time, est. planned times for those ahead, and one big button for the next tap (Start trip, Arrived at …, Leaving …, End trip); "End trip now" with a confirm for a trip cut short (it says the stops left are marked not reached and go back to the Scheduler); "Problem here?" under the current stop opens the stop report (below); a missed stop shows as one warning line; a trip held for the Scheduler shows a red notice in place of the next button ("Reported. Wait for the Scheduler's answer before going on.", or that the route is being changed), and the latest answer shows as a blue notice above the trip ("Scheduler's answer at 3:42 PM: Skip Site Alpha and go on to the next stop."); a "Route changed" notice after an approved change; no requester, distances or coordinates; then a big Complete trip) | Driver |
| `attendance` | `app/admin-attendance.tsx` (Start/End taps per trip and a Stops column, "N of M tapped" with flags and a View dialog of the stop times; away from the place, no location and late taps flagged in warning color; places link to Google Maps, with the exact coordinates and the phone's ± accuracy below; Download CSV opens a dialog with the same filters, starting from the screen's, and saves the rows they pick) | Admin, Finance |
| `finished` | `app/driver-finished-trips.tsx` (Driver), `app/admin-finished-trips.tsx` (Admin; a Form filter: All forms / Daily Vehicle Trips / Company Trips; the trip dialog shows the stop times with Fill in / Change per time, "N times missing" in the list, and Mark as done disabled until none are; Print gives the Daily or the Company Trip Form; Download CSV opens a dialog with the same filters, starting from the screen's, and saves the trips they pick; Finance gets it with `readOnly`: Print and Download only) | Driver, Admin, Finance |
| `settings` | `app/settings.tsx` | Admin. Each tab is a rail of lists on the left and one list on the right (`app/settings-lists.tsx`; on a phone the rail first, "All lists" back), with a search across the tab, a yellow banner for what still needs setting up, and a ⚠ count on the list that needs it. Accounts (`app/settings-accounts.tsx`): People by type, Access (Can drive / Can request company trips), Pending invites last; a row shows username · email, type and position, Access chips and Status; Email shows a "Not confirmed" badge and Resend while a new one waits; Edit has Position, Can request company trips, Driver type and a Scheduler's or Company car Driver's request switches; no Add Account, since invites are the only way in. Invite people is a button beside the tabs (`app/invites-panel.tsx`): a box of pasted emails plus one account type and set of request switches for the batch, then a summary of sent / skipped / not emails / couldn't send, and Resend / Cancel per invite. Vehicles (`app/settings-vehicles.tsx`): All, Kind (Can be requested for company trips / Daily trips only), Needs attention (No Driver assigned, No odometer, Inactive); a company vehicle's Driver reads "Picked per request" and its Edit has no Assigned Driver. Request choices (`app/booking-options.tsx`, `lib/choice-lists.ts`): Every request and Company Trips only lists, each tagged Required / Needed for Urgent stops / Needed for Company Trips / Optional) |
| `account` | `app/(app)/account/my-account.tsx` at `/account` (Username, Email and Password panels, each folded behind Change and asking for the current password; a pending email shows as "Not confirmed") | All roles |
| link pages | `app/(auth)/join`, `forgot-password`, `reset-password`, `confirm-email` (the sign-in card's look; open signed in or not) — Join shows the invite's email and what it allows ("Requester · Daily requests · Company trips") and asks for name, username and password, plus Position only when the access needs it (required with company trips, optional for an Admin); Forgot password takes a username or email; Sign In has a Forgot password? link and says "Password changed" after a reset | Anyone with the link |
| — | `app/booking-options.tsx` | Admin (projects/destinations/purposes, Urgent reasons, Starting points, Suppliers, Immediate Supervisors, PM / CM / Dept. Heads; a destination's Location column and field take pasted coordinates or a Google Maps link) |

**Scheduling** (`app/scheduling.tsx`, prototype "KOVA Scheduler",
2026-10-14/15) is the Scheduler's one planning screen for Daily and Company
trips. It replaced Create schedule and the Company trip planner; their old
addresses (`/schedules/new`, `/schedules/company`) redirect to it, and
`?date=&type=DAILY|COMPANY` keeps the day and kind in the address. From the
top:

- the month, then two weeks of date cards from today (Sundays included),
  each with its waiting and urgent counts, arrows to page a week at a time,
  and "Also waiting" buttons for days beyond the strip;
- a **Daily trips | Company trips** switch, each with its counts;
- an Urgent banner per urgent stop with **Fit it in**, a banner per trip
  waiting for the Admin, and the blue day banner (trips, still to plan)
  with **Undo**;
- two columns: **To plan** (stop cards, Urgent first, stops at the same
  place grouped with **Plan together**, then "Any day this week", then
  "Missed or past due" when there are any: each card tagged Missed and
  saying the day it was for), and the
  vehicles (`app/scheduler/vehicle-card.tsx`): folded by default, each
  with its Driver, a summary and the trip's state; one opens when clicked
  or when something is added to it.

A stop is dragged onto a vehicle (the card shows whether it can take it)
or tapped: a sheet slides in from the right with its details and the
options, best first (`app/scheduler/plan-options.tsx`), each saying when
it would arrive, how it fits, and what it would make late. Each trip's
legs (`app/scheduler/trip-editor.tsx`) follow the form: Origin, Time Out,
Destination (waiting stops and fuel / errand stops), Time In. Legs reorder
by dragging ⠿ or with the arrows; **Remove** opens the remove-leg dialog
(back to To plan, or back to the requester with a reason). Warnings (⚠)
name the stop and the times involved and block Submit. Below the legs a
box says what the trip waits for, with **Submit / Resubmit for approval**
and **Discard**, or **Propose changes** on an approved trip (its legs
stay locked until pressed). Left out on purpose (owner, 2026-10-15):
timeline bars and "Plan for me".

A trip on the road (Start trip tapped) keeps its reached legs locked, shown
as done; the legs after the last one reached can be edited, which opens
draft changes for the Admin. Stop reports show as banners above the day
banner. One waiting for an answer (red, "The Driver is waiting for your
answer") has **Skip it, go to next**, **Wait there**, **End the trip** and
**Change the route**; Change the route opens the vehicle's trip to edit,
and the banner (amber) then says the Driver waits for the Admin's
approval, still offering the other three. A missed stop (red) has **Plan
again** and **Send back to requester** (a reason field, then Send back),
and **Another day** (a date field, then Move, which opens that day with
the stop's options); an older report needing no planning (amber) has
**Got it**.
Today's view also shows reports not handled on their own day, naming it.

**Stop report** (`app/stop-report-form.tsx`, shared by My Schedule and My
Trips): "What happened at …?", then one big button per kind (label and a
one-line hint) so it's one tap on a phone; where several requests share the stop, Not
available and Wrong address ask **Which ones?** (a checkbox per request,
"52-A · Delivery · Cement, 20 bags", all ticked); an optional note; "The
trip waits here until the Scheduler answers."; Back and Send report.

The v1 screens (Schedule grid, booking flow, Booking Approvals, Daily Vehicle
Record editor, review and history viewers) were removed with migration 0032.

All screens are client components (`"use client"`) that read/write through
`lib/kova-api.ts`'s in-memory cache, refreshed by re-calling
`hydrateKovaData()` (a fresh `GET /api/bootstrap`) after every mutating
call. Screens read it with the `useKovaData()` hook (`lib/use-kova-data.ts`,
built on `useSyncExternalStore`), which re-renders them whenever the cache is
replaced; derive lists from it with `useMemo` rather than copying them into
state. A step that needs the cache as it is right now, outside a render
(Scheduling's Undo), reads `getSchedules()` instead.

## Sorting tables (2026-10-08)

Every trip table (My Schedule, Attendance, the three Finished Trips screens)
has sortable column headings (`app/sortable-head.tsx`, `lib/table-sort.ts`):
click once for ascending, again for descending, a third time for the screen's
own default order. Phones hide table headings (stacked tables), so the filter
row there gets a "Sort by" picker with the same choices. Schedules shows
cards, not a table, so its Sort by picker shows on every screen size; the
Week view keeps its days and sorts within each. Sorts are not remembered
between visits.

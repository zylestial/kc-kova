# KOVA v2.0 — Phased implementation plan for Claude

## Deployment decision

Upgrade v1.2 to v2.0 using the **same repository, existing database and existing Vercel project/domain**. Use a v2 development branch and isolated test data, then migrate production in place. No second production database or new hosting project.

## Instructions to Claude

You are modifying my EXISTING KOVA application. Implement the plan one phase at a time. Ask for approval to start Phase 0 first; after approval, inspect the actual repository before making assumptions. Do not rebuild the website, introduce a new stack unnecessarily, or treat this as a browser-storage prototype.

Preserve the existing brand, logo, colors, typography, components and Daily Vehicle Record print layout. Reuse existing screens where practical. Small actions, confirmations and Add/Edit operations use modals. Driver screens must work on phones.

This document is the implementation target. The accompanying flow PDF is a visual guide. Follow the latest rules here if older documents describe Driver-entered legs, digital Finance fields, Admin-created schedules or a separate Company Trip Form.

For each phase: state the intended scope, inspect dependencies, implement a reviewable change, run focused tests, and report changed files, migrations, test results and remaining risks. Do not claim that a test, backup, migration or deployment succeeded without verifying it. Do not advance past a failed acceptance gate. Ask for explicit approval before starting each phase, including Phase 0. Approval covers that phase only; do not automatically continue into the next phase. Within an approved phase, carry out the agreed work without asking about every routine step. Obtain separate explicit release approval before modifying production data or switching live traffic. Never expose secrets in reports.

## Phase approval, conflicts and repository cleanup

### Ask before every phase

Before starting a phase, briefly explain its goal, planned changes, affected features/files, database or deployment impact, proposed removals and acceptance checks. Ask: **"May I start Phase N?"** Wait for my explicit approval. Do not treat approval of this overall plan, or completion of the previous phase, as approval for the next phase.

After each phase, report what changed, what was removed and why, tests and results, and unresolved issues. Then propose the next phase and wait for approval. If scope materially changes during a phase, explain the change and ask before proceeding with the expanded scope.

### Clarify clashes with me

If planned features, existing behavior, permissions, data rules, migration requirements or documents conflict, stop the affected work and explain the clash in plain language. Show a concrete example, the available choices and your recommended option. Ask me which behavior to use; do not silently pick a winner, weaken a rule or invent a new workflow. Continue only unrelated work that is already approved and does not depend on that decision.

Record my decision in this plan or a decision log and update the affected acceptance checks. A failed test caused by conflicting requirements is a reason to clarify the intended behavior, not to remove the test or bypass the requirement.

### Remove unnecessary repository content

Audit the current repository for obsolete prototype code, duplicate components, abandoned routes, unused assets and dependencies, temporary exports/build artifacts, superseded scripts and outdated documentation. Remove items that are demonstrably unnecessary for the approved v2 workflow; do not merely leave redundant implementations beside their replacements.

- During Phase 0, prepare a cleanup inventory; do not delete yet. Identify each candidate, why it is unnecessary, its references/dependencies and any migration or rollback use.
- Include relevant proposed removals in each phase's approval request. Perform cleanup in the approved phase after its replacement works, rather than performing an unreviewed mass deletion.
- Check imports, dynamic routes, scripts, deployment configuration, runtime usage, tests and migration history before declaring an item unused. Ask me if its purpose or necessity is uncertain.
- Preserve uncommitted user work, required assets, account/data history, applied migration files, working Vercel/database configuration, secrets configuration references and all agreed backup/rollback resources. Removing obsolete repository code does not authorize deleting production data or rewriting Git history.
- Remove genuinely unused dependencies with the existing package manager and update the lockfile. Do not replace the dependency stack or prune packages based only on a superficial text search.
- Keep cleanup reviewable and reversible in Git. Run the relevant build, type checks and focused workflow tests afterward; list removed paths and reasons in the phase report.
- In Phase 12, complete a final cleanup audit and report any deliberately retained legacy items and why they remain necessary. Historical migration/rollback files are not unnecessary merely because the new interface no longer uses them directly.

## Target workflow and roles

Requester submits a date-based request → Scheduler assigns a vehicle and prepares the ordered Trip Record → Admin approves → Driver views the approved route → Driver confirms completion and submits odometers → Admin reviews, prints and marks Done.

Use **Requester** in the interface and **`requester`** as the internal role value throughout v2. This is a full role rename, including the backend and database, not a display-only change. Remove the previous role from active v2 account types, validators and permission checks; do not keep it as an alias. Exactly four account types: Requester, Scheduler, Admin and Driver. Preserve account IDs, ownership links and historical records during migration.

| Role | Menu | Permissions |
|---|---|---|
| Requester | New request, My requests, Schedules | Own requests; approved schedules containing their requests; relevant PDFs |
| Scheduler | Create schedule, Schedules | View scheduling requests; create drafts, assign vehicles, order routes, submit schedules and revisions |
| Admin | New request, My requests, Schedules, Finished trips, Settings | Request transport, including past dates; edit Scheduler-created schedules; approve, return or cancel; review finished records; manage settings |
| Driver | Schedules, Finished trips | Own approved schedules; completion confirmation, starting/ending odometers; own submitted records and permitted PDFs |

**Only Scheduler creates schedules. Admin cannot create schedules**, including through direct API calls. Admin can edit an existing Scheduler-created schedule. There is no Finance role, PM role or COO role.

## Phase 0 — Inspect v1.2 and establish the baseline

1. Read repository instructions, package scripts, existing migrations and deployment configuration. Check working-tree changes and preserve unrelated work.
2. Reuse the existing v1.2 Vercel project and production database. Identify their actual configuration, database provider, authentication system, environments, production branch and deployed commit. Do not assume `main` is the live branch.
3. Verify the user-reported implementation rather than treating it as inspected evidence:
   - `POST /api/bookings` and `create_booking` RPC.
   - Booking slots and vehicle/Driver conflict constraints.
   - Same-vehicle/same-day Driver trigger.
   - `cancel_booking` and soft cancellation.
   - `PUT /api/records/:recordId`, submission locks, history and Done locking.
   - RLS, service-role usage, account roles and existing print components.
4. Document existing capabilities, missing capabilities and database dependencies. Trace one request through UI, API and database permissions.
5. Record the existing build/test result and known failures. Identify existing production records that cannot map cleanly to v2.
6. Prepare the repository cleanup inventory and list feature/permission/data conflicts for my decision. Do not remove anything during the audit.

Deliver: `docs/v2/baseline.md`, role/access matrix, current environment map and prioritized implementation risks.

Gate: know which code and database are live; identify migration risks without changing production.

## Phase 1 — Git protection and development branches

Use the SAME repository. Do not fork a duplicate repository simply to build v2.

1. Preserve the verified production release with an annotated tag such as `v1.2-stable`. If that tag already exists, verify it; do not move or overwrite it. Tag the actual deployed commit, not an unverified working-tree snapshot.
2. Create `v1-maintenance` from the stable release if there is no equivalent maintenance branch.
3. Create `v2-development` from the agreed baseline. Bring necessary newer fixes in through reviewed changes; do not accidentally start from obsolete code.
4. Use focused branches and pull requests into `v2-development`, for example:
   - `feat/v2-foundation`
   - `feat/v2-requests`
   - `feat/v2-scheduling`
   - `feat/v2-approvals`
   - `feat/v2-driver-completion`
   - `feat/v2-printing`
5. Keep production deployment tied to the existing release flow. A merge to `v2-development` must not deploy over v1.
6. Apply urgent v1 fixes to maintenance, then carry relevant fixes into v2 with tests. Never force-push shared history or delete the working v1 baseline.

Deliver: branch/release map and rollback references in `docs/v2/git-and-release.md`.

Gate: v1 code can be recovered exactly; v2 branches cannot deploy to v1 accidentally.

## Phase 2 — Reuse the v1.2 database and Vercel project

Keep the SAME repository, existing production database, Vercel project and public domain. Do not create a second production database, move providers, replace authentication or copy live data into a new production project.

| Environment | Code | Database | Purpose |
|---|---|---|---|
| v1.2 live | Verified current production release | Existing production database | Continue operations during development |
| v2 local/test | Feature branch | Disposable local database or isolated test copy | Run destructive and concurrency tests safely |
| v2 preview | v2-development / feature branch in the same Vercel project | Isolated test data source; not live write credentials | Review v2 before launch |
| v2 live | Approved v2 release in the same Vercel project | SAME existing production database, upgraded in place | Replace the application without moving its data |

1. Inspect the existing Vercel project link, framework configuration, production branch, domains and environment-variable scopes. Preserve the working deployment configuration; use the existing framework rather than the old Sites prototype setup.
2. Configure preview builds for v2 branches without replacing the live deployment. Add a visible Preview label. Verify the current Vercel behavior/settings before configuring it.
3. The shared production database is for real operations. Test migrations against a disposable local instance or isolated copy. This is a test fixture, not a replacement production database. Do not automatically create paid remote resources.
4. Preview must not use live write credentials. If no isolated test database is available, keep preview in clearly labelled demo/read-only mode and run integration tests locally. Do not pretend mock tests validate production database behavior.
5. Preserve existing auth users, IDs, file storage and credentials. Check environment-specific auth redirects and cookie behavior. Keep secrets outside Git and client bundles.
6. Run schema migrations as explicit controlled operations, never automatically during every Vercel build, preview deployment or request.
7. Prepare backups of the existing database and files; verify restoration in isolation. Record migration versions so each app release has a known compatible schema.

Deliver: existing-project deployment map, scoped environment-variable names without values, preview setup, isolation evidence and restore instructions.

Gate: v1.2 remains live; v2 previews cannot accidentally alter live data; no production database/provider move is planned.

## Phase 3 — Database model, permissions and state transitions

Write versioned migrations and a migration manifest. Rehearse on local/test data first. Upgrade the existing production database in place using expand, migrate and later contract steps. Add compatible tables/columns before removing anything. Preserve legacy tables and records through the rollback period. A preview deployment must never apply live migrations.

### Full Requester role migration

- Inventory every use of the previous request-creation role: stored account/profile values, database enums or constraints, auth metadata and token claims, RLS policies, RPCs, API validators, route guards, generated types, seeds, tests, account forms and documentation.
- Migrate existing request-creation accounts to `requester` in the existing database during the controlled v2 release while preserving IDs, credentials/identity links, ownership and historical records. Renaming a role must never delete its accounts or requests.
- Update all role checks together. Remove the previous value from the final v2 role enum/constraint and accepted API inputs after data and dependent policies/functions have been migrated. Do not leave two equivalent request-creation roles.
- Refresh or invalidate stale sessions/role claims using the authentication provider's supported approach. Do not trust a stale client role or accept the previous role as a fallback. Document any required sign-in again.
- Keep original immutable audit events and archived v1 records as evidence; do not rewrite historical event text simply to rename the role. The obsolete role is allowed only as a source value in migration code and preserved legacy history, never as an active v2 role.
- Rehearse the conversion in tests, but do not rename live roles while incompatible v1.2 code is still serving users. At cutover, pause writes, deploy the prepared compatible release, migrate roles and claims, and validate before resuming. If a compatibility release is needed, its temporary transition support must have an explicit removal step; the final v2 application accepts only `requester`. Preserve the v1.2 tag and backups. An old-code rollback is unsafe after a role rename unless that code supports the new value or the role migration is safely reversed.
- Verify migrated accounts can sign in and use Requester functions, cannot access other roles' functions, and keep access to their existing records. Verify old role values are rejected by new v2 account creation/update APIs and cannot grant permissions through stale claims.

Use the existing naming conventions; the following are conceptual records, not mandated table names:

| Record | Required information |
|---|---|
| Request | Owner account ID, name snapshot, requested date, Regular/Urgent, project/site option or Other text, timestamps, state |
| Request destination | Request ID, destination ID/name snapshot, purpose ID/text snapshot, original order |
| Schedule | Date, vehicle, assigned Driver snapshot, Scheduler creator, state, published version, timestamps |
| Schedule revision | Version, parent schedule, ordered legs, planned times, approval state and approval details |
| Request inclusion | Original request linked to a schedule; preserve history and active/inactive inclusion |
| Leg/request mapping | All request-destination entries served by a shared stop; retain each requestor and purpose |
| Reservation | Vehicle and Driver time occupancy associated with the correct draft/published version |
| Completion | Exact approved version, confirming Driver, start/end odometer, distance, server submission time, review/Done state |
| Problem report | Driver, schedule/version, note, creation time, Admin handling and linked follow-up work |
| Audit history | Actor, action, affected record, time, reason where needed, before/after changes |

Important database behavior:

- One active Driver assignment per vehicle and one active vehicle assignment per Driver, retaining the established assignment rule. Admin alone changes it. Saved schedules retain their assigned Driver; do not rewrite history on reassignment.
- One request is for one date. All its destinations stay in one active schedule. Historical cancelled inclusions do not block legitimate rescheduling.
- Multiple requests may share a stop. Do not deduplicate requests merely because date/destination match.
- Draft reservations block overlaps. Preserve vehicle and Driver conflict enforcement under simultaneous requests. Inspect whether existing hour-slot granularity fits planned times; retain supported precision or deliberately migrate it rather than silently rounding.
- Request inclusion and edit-lock changes must happen together. Competing edit/include or include/include operations must not produce inconsistent records.
- Approval, cancellation, submission and revision publication must check current state inside a transaction. Use the existing safe RPC/transaction pattern where suitable; do not rely only on hidden buttons or route checks followed by an unprotected write.
- Preserve append-only change history and Done locking. Do not trust client-supplied identity, approval time or submission time.
- Finance is print-only. Do not create new digital Finance entry requirements. Preserve legacy Finance data for history; do not destroy it when removing the UI.

Separate request progress, schedule approval, cancellation and completion states. A pending cancellation must not pretend the schedule is already cancelled. Derive request progress consistently where possible rather than maintain conflicting copies.

Deliver: schema diagram, migrations, permission matrix, transition rules and concurrency tests.

Gate: direct unauthorized reads/writes fail; concurrent conflicts are rejected; historical information survives edits.

## Phase 4 — Requester and Admin request creation

Preserve existing design and components, adapting the booking flow to:

1. Select date only, with month/year visible.
2. Enter Regular/Urgent, optional Project / Site dropdown with Other text, and one or more destinations, each with its own purpose.
3. Review in a modal; Edit returns without clearing inputs; Submit request saves and opens My requests.

Requirements:

- No vehicle, Driver or time selection at this stage.
- Requested By comes from the signed-in account name and ID, not a person dropdown.
- Active options only for new selections; snapshots preserve old values after changes/inactivation.
- Regular: at least seven calendar days ahead. Urgent: today or tomorrow. Dates two to six days away remain disallowed under the current rule. Validate in Philippine calendar dates on the server.
- Admin may request past dates. Preserve real entry timestamps; include a tested historical scheduling/completion path rather than leaving these requests unusable.
- My requests for both Requester and Admin shows their own submissions and progress.
- Requester can edit until inclusion in a saved draft. A stale open form cannot bypass the lock.
- Retain existing People settings/history, but remove People selection from new Requested By behavior.

Gate: multiple destinations/purposes, Other text, deadline boundaries, historical Admin requests, snapshots and editing locks work.

## Phase 5 — Scheduler planning and Trip Record

Only Scheduler gets Create schedule.

1. Choose day; view request pool and existing commitments.
2. Select requests for that date.
3. Assign vehicle; automatically select its assigned active Driver.
4. Arrange the Trip Record in consecutive legs using the existing form components.
5. Set planned times, validate and Save draft or Submit for approval.

Trip Record requirements:

- Requestor from each request; purpose/activity; leg number; origin; planned Time Out; destination; planned Time In; destination contact name/number if available.
- Start at ANONANG. Next origin follows previous destination.
- Add leg and Add final leg sit side by side below the last leg. Add final leg appends read-only ANONANG destination. Hide add buttons until final leg is removed. Prevent duplicate final legs; keep existing valid historical routes readable.
- Do not automatically insert current times. Do not require unavailable contacts or digital signatures.
- Keep every destination in each request within its schedule. Preserve request data when rearranging travel order.
- Group matching destinations for Scheduler review; never merge automatically. When compatible in timing/capacity, one stop can serve Juan's inspection and Maria's document delivery, retaining both names and purposes.
- If sharing does not work, schedule separate trips without conflicts. Do not introduce a new passenger/capacity subsystem without need; make capacity a clear scheduling check with available information.
- Day/Week views and date, vehicle, Driver and status filters support weekly planning.
- Saving a draft reserves time and locks included requests. Discard draft frees its reservations and returns its requests to Not yet scheduled, unlocked. Draft discard is not cancellation of an approved schedule.

Gate: shared stops, mixed purposes, request ownership links, route continuity, reservation collisions and draft disposal are tested.

## Phase 6 — Approval, revisions and publication

Admin opens a Scheduler-created schedule, reviews it, edits if needed, approves or returns with comments. Admin creation remains prohibited at the backend.

- Resolve pending request cancellations before approving an affected schedule.
- Approval publishes to the assigned Driver and relevant Requesters; reservations remain in place.
- Only approved instructions are visible to Driver. Requesters see only permitted details and their relevant schedule PDFs; do not leak other requestors' unrelated information.
- Proposed revisions retain the current published version and its reservations while waiting. Track proposed occupancy separately as needed; do not release the current reservation or count the same schedule as a conflict with itself.
- Approval rechecks conflicts and replaces version/reservations together. Failed approval leaves the current schedule intact.
- Show Updated schedule after an approved revision. Retain version and approval history; include identifying version/date on schedule output where compatible with the existing layout.
- Completion submission references the precise approved version. Once submitted, scheduling revisions are blocked, including concurrently pending approvals. Admin corrections operate on the finished record with history.

Gate: Driver never sees draft instructions; approved revisions replace consistently; stale edits and approval/submission races are handled.

## Phase 7 — Cancellation and request unlocking

Implement confirmation modals and history, never hard deletion.

| Action | Required behavior |
|---|---|
| Requester cancels own unscheduled request | Immediate cancellation after confirmation |
| Included request cancellation | Request Admin confirmation; keep current schedule effective while pending |
| Admin declines request cancellation | Request and schedule remain active |
| Admin confirms included cancellation | Cancel only that request; review and publish any route/time changes |
| Shared-stop cancellation | Retain the stop while another request still needs it |
| Scheduler removes request from draft | Not yet scheduled, unlocked, available again; update affected reservations |
| Scheduler discards unused draft | Free its reservations and unlock included requests |
| Admin cancels schedule | Free reservations; return still-needed requests to Not yet scheduled and unlock; already cancelled requests stay cancelled |

Do not offer cancellation as a substitute for correcting an already submitted or Done completion. Handle those through finished-record rules. Preserve approved historical versions.

Gate: no stranded locked requests, no accidental cancellation of other requestors, no orphan reservations, and repeat actions are safe.

## Phase 8 — Driver completion and problem reporting

Driver menu: Schedules and Finished trips. Phone layouts must work at narrow widths with large touch targets and readable modal scrolling.

Normal flow:

1. View own approved route, vehicle and planned times.
2. Finish trip enabled after scheduled end, using server eligibility checks.
3. Modal: Have you completed this trip? Not yet / Yes, continue.
4. Yes: enter starting and ending odometer only. Both numeric, nonnegative; ending >= starting. Calculate distance automatically.
5. Review and Submit trip. Preserve inputs on failure and prevent duplicate submissions.
6. Save server submission timestamp, status SUBMITTED FOR REVIEW, lock Driver edits and scheduling changes, show under Driver/Admin Finished trips.

One odometer pair covers the whole assigned schedule, not each included request. Driver does not re-enter legs, planned times, purposes, contacts, signatures, Finance or return confirmations.

Problem flow:

- Report a problem opens a short note modal; it does not require claiming completion or inventing odometers.
- Admin reviews which work remains. Do not automatically complete every included request.
- Preserve the original approved route and link follow-up work to the problem/original request. Scheduler creates the follow-up schedule and Admin approves.
- A follow-up for unfulfilled work is not simultaneous splitting of the original request. Record the exception explicitly and prevent duplicate active fulfillment. Document this handling before migration implementation.

Gate: ownership, eligibility, whole-schedule completion, readings, retries, locks and incomplete-trip handling work on mobile and direct APIs.

## Phase 9 — Admin finished trips and printing

Reuse the existing Daily Vehicle Record. Filters: date, Driver, vehicle and status.

Admin flow: Review → Edit if needed → Save with history → View PDF / Download PDF / Print → Mark as done confirmation.

- Scheduler's route remains planned information. Driver confirmation and readings are completion information; do not fabricate actual leg times.
- No Finance input fields or Finance-entry step on the website.
- On the final printed form, Finance lines/checkboxes remain blank for handwriting, including Date Submitted. Driver submission time stays in internal history, not Finance auto-fill.
- Keep signature spaces and return-confirmation checkboxes blank for handwriting. Keep PM Joedel Capillan and COO President Vargas without creating new account roles.
- At shared stops, retain all relevant requestor/purpose pairs. Support longer text and overflow pages without clipping or shrinking to unreadable size; preserve the print design as closely as practical.
- Driver can access own submitted PDF without Finance; Requester gets relevant approved schedule PDF; Scheduler gets schedule output; Admin gets the full final form with blank Finance section.
- Authorize PDF generation/download server-side. Do not leak restricted data in hidden HTML or downloadable file URLs.
- Mark as done locks the digital record for everyone. It does not assert that handwritten Finance processing occurred.

Gate: render sample PDFs including shared stops, long names and many legs; visually inspect output and enforce role access.

## Phase 10 — End-to-end validation and migration rehearsal

Test all four roles with representative fixtures, including inactive accounts and assignments. Use API/database tests for permissions and concurrency, plus a focused browser suite for user journeys.

Mandatory scenarios: two same-date/same-destination requests; separate purposes; cancellation of one shared-stop request; draft discard; whole-schedule cancellation; conflicting Scheduler saves; stale Requester edit; approval/revision race; approval versus cancellation; completion versus revision; repeat submission; Done lock; midweek date labels; past-date Admin entry; mobile Driver completion; blank Finance output.

In-place migration plan:

1. Inventory accounts, assignments, options, bookings, slots, records, history and files in the existing database. Back up first; keep original IDs and references. Do not reset, truncate or recreate production tables.
2. Add new request, schedule, revision and completion structures as needed. Reuse sound existing structures. Every change must have a versioned migration, validation query and recovery notes.
3. Prepare resumable, idempotent backfills from existing bookings into linked v2 records in the SAME database. Track source IDs and migration markers so retries cannot duplicate records or reservations. Source and derived booking occupancy must not reserve the same trip twice.
4. Rehearse against an isolated restored/sanitized dataset. Validate the role conversion to `requester`, account ownership, counts, foreign keys, states and existing sign-in behavior. Do not export passwords or recreate accounts unnecessarily.
5. Do not invent Scheduler creators, approvals, purposes, signatures or odometers for legacy records. Preserve provenance and legacy completed records, PDFs and Finance history. New blank-Finance behavior does not erase past completed forms.
6. Define the treatment of future v1.2 bookings. Preserve their reservations and prevent duplicate allocation during transition. Existing confirmation does not silently become v2 Admin approval: review these plans before the switch, or keep them operational through an explicitly documented legacy path until reviewed. Do not make existing Driver assignments disappear without a transition plan.
7. If v1.2 keeps accepting writes while backfills run, capture and reconcile changes before cutover. Prefer a brief final write pause over untested dual-write synchronization.
8. Validate totals, ownership, dates, assignments, reservations and sample PDFs before and after backfill. Report every unmapped record. Measure the final write pause and rehearse rollback.

Gate: role journeys pass; in-place backfills reconcile; existing records remain accessible; schema and role changes have a tested release order.

## Phase 11 — Release through the same Vercel project

Prepare the complete release and evidence before requesting go-live approval. Keep the existing production database, Vercel project and domain.

1. Tag the tested release candidate. Record the current v1.2 deployment/commit, schema version, environment configuration and backups.
2. Apply only independently approved, backward-compatible expansion migrations while v1.2 remains live. Leave destructive schema cleanup for a later release after the rollback window.
3. Prepare the v2 build and verify environment settings for the existing Vercel project. Do not create a replacement project, change DNS or switch databases. Consult the current provider workflow before choosing the deployment/promotion command.
4. Obtain release approval for the coordinated database and application switch. Pause live writes, take the final backup/checkpoint and reconcile any changes since the rehearsal/backfill.
5. Execute the tested migration/deployment order. Convert account roles and auth claims, finish backfills, activate v2 and retire the old mutation paths. No incompatible old application instance or direct API may keep writing during the transition.
6. Validate sign-in, role access, pending requests, existing reservations, schedule approval, completion and PDF output in production before unpausing writes. Use controlled test records with a documented cleanup policy.
7. Resume operations at the existing URL. Tag `v2.0.0`, monitor failures and retain the v1.2 release reference. Legacy history stays accessible through an authorized read-only path; do not reconnect an incompatible old deployment to the changed database as an archive.

Rollback rules:

- A Vercel deployment rollback changes application code, not the database, auth claims or files. Never promise that selecting the previous deployment restores the entire system.
- If changes are additive and the previous application is verified compatible, restore that deployment while leaving harmless additions in place.
- After converting roles or workflow states, freeze writes and use the rehearsed compatibility/reversal procedure before returning to v1.2. Preserve IDs and all accepted records; invalidate stale sessions as required.
- After new v2 writes, preserve the database and logs and reconcile v2-only requests/schedules/completions before considering old code. Prefer a forward fix when it protects accepted data better. Restoring an older backup without reconciliation loses new records.
- Keep an explicit compatibility matrix: application release, database migration version and account-role format. Do not run destructive down-migrations merely to make a rollback command succeed.

Deliver: `docs/v2/cutover-runbook.md`, `rollback-runbook.md`, migration evidence, deployment references and launch checklist.

Gate: the same production system now serves v2 without losing existing accounts, records or files; no unapproved live change occurs.

## Phase 12 — Stabilize and hand over

Verify real usage across all four roles, fix regressions in small releases and retain v1.2 backups and release references for the agreed retention period. Do not remove old tables, backups or deployment recovery options merely because initial launch succeeded.

Hand over setup instructions, environment map, schema and permissions, role test guide, migration history, deployment/rollback steps and known limitations. Each follow-up release must state whether a database migration is required.

## Begin here

First summarize Phase 0 and ask for permission to start it. After approval, inspect and report the actual current code, database and deployment baseline, the full internal Requester role migration needs, cleanup candidates and any conflicting requirements. Do not begin Phase 1 Git changes until I approve Phase 1 separately. Do not deploy v2 to production, migrate live data, change the existing database or replace the live domain or rebuild the interface as part of the initial phase.

# Admin guide

An Admin is the operational owner of KOVA. This role manages accounts, approves schedules, closes out completed trips, and maintains shared reference data such as vehicles and request choices.

## What an Admin can do

- Create and update user accounts
- Reset passwords and manage account status
- Create or rename vehicles
- Manage projects, destinations, purposes, and inactive options
- Approve or return submitted schedules
- Cancel schedules and confirm or reject cancellation requests
- Review submitted completions and trip issues
- Correct trip times and mark completed trips Done
- Act as a Scheduler or Driver through Admin override views when needed

## Starting points

- Admin / dashboard: approvals, schedule review, and operations summaries
- Accounts: create accounts and manage credentials
- Vehicles: maintain the fleet and assigned Drivers
- Booking options: configure destinations, purposes, and projects
- Finished trips: review submitted completions and close them out

## Typical workflow

### 1. Manage access and fleet

- Create a new account and assign the correct role.
- Inactivate an account when it should no longer sign in.
- Add vehicles and assign the Driver to each vehicle.
- Keep choice lists current, but never hard-delete historical options.

### 2. Review schedule submissions

- Open submitted schedules awaiting approval.
- Confirm the route, vehicle, and timing before approving.
- Return a plan with clear comments when it needs changes.
- Cancel an approved schedule when operationally necessary.

### 3. Close out trips

Once a Driver submits a trip completion:
- verify odometer readings and the trip record
- fill in missing times if needed
- review problem reports with any follow-up scheduling notes
- mark the trip Done when all required checks are complete

A Done trip is locked and becomes read-only for everyone.

### 4. Handle cancellations

- Confirm legitimate cancellation requests when the schedule still needs to change
- Decline requests with a note when they do not meet the policy
- Keep the history of the trip intact; cancellations never delete records

## Key guardrails

- Only an Admin can approve schedules, manage accounts, change vehicles, and edit reference data.
- Historical data is never hard-deleted; inactive records remain visible as needed.
- A submitted or Done trip stays locked according to the business rules.
- The backend enforces these permissions, not just the UI.

## Best practices

- Keep user accounts current and ensure the correct role is assigned.
- Review schedules promptly so Requesters and Drivers know whether the trip is approved.
- Check trip times and problem reports before marking a trip Done.
- Maintain destination and purpose choices carefully so new requests remain accurate and consistent.

## Quick checklist

- [ ] Create or update accounts
- [ ] Verify vehicle and Driver coverage
- [ ] Approve or return schedules
- [ ] Confirm or decline cancellations
- [ ] Review submitted trips
- [ ] Correct times or problem reports as needed
- [ ] Mark the trip Done only when all required information is complete

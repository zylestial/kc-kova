# KOVA role guide

This is the single reference for each role in KOVA. It combines the Requester, Scheduler, Admin, and Driver workflows into one operational guide, with the end-to-end flow from Admin setup through Driver completion.

## Role summary

| Role | Main responsibility | Typical starting screen | Key actions |
| --- | --- | --- | --- |
| Requester | Ask for transport and track requests | My requests | Create requests, edit or cancel before planning, watch schedule status |
| Scheduler | Build the day plan | Schedules | Review pool, assign vehicles, create the route, submit for approval |
| Admin | Run operations and approvals | Admin dashboard | Invite people, maintain vehicles and options, approve schedules, close trips |
| Driver | Execute assigned trips | My schedule | Start and end trip, tap stops, submit completion, report problems |

## End-to-end flow: Admin to Driver

1. Admin invites people by email (Settings → Accounts → Invite people), choosing one account type and its request permissions per batch; each person sets up their own username and password from the emailed link.
2. Admin adds or updates vehicles and assigns each vehicle to a Driver.
3. Requester creates a trip request with date and stops.
4. Scheduler reviews the request pool and builds the trip record.
5. Admin approves the plan, or sends it back with a reason.
6. Driver sees the approved trip in My schedule.
7. Driver taps Start trip, records stop activity, then taps End trip.
8. Driver submits the odometer readings and trip completion.
9. Admin checks the submitted trip, fills in any missing times, handles issues, and marks it Done.

This is the operational lifecycle of a trip in KOVA: setup → request → planning → approval → execution → closeout.

---

## Requester role

A Requester is the person who asks for transport. The Requester is focused on request creation, tracking, and responding to changes while the trip is unplanned.

### What a Requester can do

- Create a request with a date and one or more stops
- Add a destination or purpose, including typed "Other" values when needed
- Edit or cancel their own request before a Scheduler starts planning it
- View the status of all requests they own
- Ask for a cancellation after the trip has been assigned to a schedule

### Requester workflow

1. Open the request form.
2. Pick the trip date.
3. Add each stop and the purpose.
4. Submit the request.

Important rules:
- 0–6 days ahead is Urgent.
- 7 or more days ahead is Regular.
- Only an Admin can log a past date.

### Requester best practices

- Submit requests early to give the Scheduler time to fit them into the day.
- Use clear destinations and purposes so the plan is easy to route.
- Check notifications after a schedule is returned or approved.
- Cancel early if a request is no longer needed while it is still unplanned.

### Requester checklist

- [ ] Create a valid request with date and stops
- [ ] Confirm it appears in My requests
- [ ] Edit or cancel before planning starts
- [ ] Watch for schedule updates or cancellation review

---

## Scheduler role

A Scheduler is responsible for building the daily plan. This role reviews the request pool, assigns vehicles, creates the trip record, and submits it for Admin approval.

### What a Scheduler can do

- Open the daily request pool
- Review urgent and regular requests
- Assign vehicles and Drivers to each trip
- Build the trip record in travel order
- Save a draft or submit a schedule for approval
- Return requests that do not fit or split a request across vehicles

### Scheduler workflow

1. Open the day being planned.
2. Review the request pool and urgency order.
3. Select a valid vehicle and Driver.
4. Create the route and trip record.
5. Save a draft if more work is needed.
6. Submit the final plan for approval.

### Scheduler best practices

- Handle urgent requests first, but verify the requested date and vehicle availability.
- Check the request pool for conflicts before saving a draft.
- Save early to keep the plan in progress without losing work.
- Send requests back with clear reasons when they cannot fit the schedule.

### Scheduler checklist

- [ ] Review the request pool
- [ ] Assign a valid vehicle and Driver
- [ ] Build the route in order
- [ ] Save draft if needed
- [ ] Submit for Admin approval

---

## Admin role

An Admin is the operational owner of KOVA. The Admin keeps the system running by managing accounts, fleet assignments, reference data, approvals, and trip closeout.

### What an Admin can do

- Invite people by email in batches, resend or cancel invites, and update accounts
- Manage account status, and set a password for someone whose email doesn't reach them (everyone else uses Forgot password on the Sign In page)
- Create or rename vehicles and assign Drivers
- Maintain Projects, Destinations, and Purposes
- Approve or return submitted schedules
- Cancel schedules and confirm or reject cancellation requests
- Review submitted trip completions and problem reports
- Fill in missing times and mark a trip Done
- Use Admin override views when acting as a Scheduler or Driver

### Admin workflow

1. Invite people, choosing their roles and access; edit accounts in Settings when something changes.
2. Maintain active and inactive fleet records.
3. Keep booking choice lists current and consistent.
4. Review schedule submissions and approve or return them.
5. Confirm or decline cancellation requests.
6. Review completed trips and close them out.

### Admin close-out flow

Once a Driver submits a trip completion:
- verify the odometer readings and trip details
- fill in any missing times or correct a recorded time
- review any problem report and follow-up schedule notes
- mark the trip Done only when all required data is present

A Done trip is locked and remains read-only for everyone.

### Admin best practices

- Keep user roles and vehicle assignments current.
- Review schedules promptly so Requesters and Drivers know the status.
- Check problem reports and time gaps before marking a trip Done.
- Preserve historical records by using inactive states instead of hard-deleting items.

### Admin checklist

- [ ] Invite people, or update accounts
- [ ] Verify vehicle and Driver coverage
- [ ] Approve or return schedules
- [ ] Confirm or decline cancellations
- [ ] Review submitted trips
- [ ] Correct times or problem reports as needed
- [ ] Mark the trip Done only when all required information is complete

---

## Driver role

A Driver executes the approved trip assigned to their vehicle. The Driver records attendance, marks route progress, and submits the completion once the trip is over.

### What a Driver can do

- See only approved trips assigned to their vehicle
- Tap Start trip at ANONANG before leaving base
- Tap End trip after returning to base
- Tap Arrived and Leaving at each stop in sequence
- Submit the odometer readings and final completion details
- Report a problem on a trip at any time

### Driver workflow

1. Open My schedule and pick the assigned trip.
2. Tap Start trip before leaving base.
3. Tap Arrived and Leaving at each stop as the route is completed.
4. Tap End trip when returning to base.
5. Submit a single odometer pair and complete the trip record.
6. If needed, report a problem so the Admin can review it.

### Driver best practices

- Record the trip as it happens instead of trying to reconstruct it later.
- Always tap Start trip before leaving and End trip upon return.
- Check the next required tap in the route flow so no stop is missed.
- Submit the completion promptly once the trip has ended.

### Driver checklist

- [ ] See assigned trip in My schedule
- [ ] Tap Start trip before departure
- [ ] Tap Arrived and Leaving at each stop
- [ ] Tap End trip on return
- [ ] Submit odometer readings and completion details
- [ ] Report problems if they occur

---

## Operational handoff summary

The full production flow is:

Admin setup → Requester request → Scheduler plan → Admin approval → Driver execution → Admin closeout

This is the path every trip follows in KOVA. The role boundaries are strict, but the workflow is shared and connected: each role contributes one part of the movement from a request to a completed, locked trip.

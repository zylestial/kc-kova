# Scheduler guide

A Scheduler is the role that plans the day. They review the request pool, assign vehicles, build the trip record, and submit the schedule for approval.

## What a Scheduler can do

- Open the daily request pool
- Review urgent and regular requests awaiting assignment
- Assign a vehicle and its Driver to each trip
- Build the Trip Record in travel order
- Save a draft or submit a full plan
- Return requests that do not fit, or split a request across vehicles
- See which vehicle or Driver already has a conflict on a day

## Starting points

- Schedules: review the day, draft plans, and submitted schedules
- Planner / schedule builder: create or revise a day plan
- Request pool: see pending requests grouped by urgency and requester

## Typical workflow

### 1. Open the day

1. Pick the date to plan.
2. Review the request pool.
3. Sort or filter by urgency and requester as needed.

Urgent requests appear first, but the Scheduler still decides whether the plan can accommodate them.

### 2. Assign a vehicle

- Pick a vehicle that is available for the requested day and time.
- Confirm the assigned Driver is valid for that vehicle.
- Keep conflicts off the plan: the system blocks overlapping bookings that use the same vehicle, Driver, or request.

### 3. Build the trip record

- Add legs in travel order
- Keep the start and end at ANONANG as required by the workflow
- Add non-request stops when needed (for example fuel or an errand stop)
- Save a draft whenever the plan is not final yet

A draft reserves a slot only when it is valid; incomplete or invalid plans are not treated as a real reservation.

### 4. Submit for approval

When ready:
- review the daily schedule for conflicts and missing information
- submit the plan for Admin approval
- send back requests that cannot be accommodated
- split a request across vehicles when needed

A Scheduler cannot approve their own schedule; the Admin is the final approver.

## Key guardrails

- Only a Scheduler can create schedules.
- The Scheduler may not edit a request that belongs to another person outside the planning flow.
- A schedule cannot violate vehicle, Driver, or request conflicts.
- A draft is a working version; approval is still required before the trip is visible to the Driver and Requesters.

## Best practices

- Start with urgent requests and check the day's open load before committing.
- Keep request pool notes clear when sending a trip back.
- Save drafts early to protect the plan while editing.
- Check the vehicle and Driver availability before building complicated multi-stop routes.

## Quick checklist

- [ ] Open the request pool
- [ ] Confirm urgent requests are handled first
- [ ] Assign a valid vehicle and Driver
- [ ] Build the trip record in route order
- [ ] Save draft if needed
- [ ] Submit for Admin approval

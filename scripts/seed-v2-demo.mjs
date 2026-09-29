// Seeds a broad set of v2 demo data (requests, schedules, completions,
// problems, cancellations) so every screen/state can be clicked through in
// a browser, on top of the accounts/vehicles/booking-options seed-uat.mjs
// already creates. Run seed-uat.mjs first (or just this script -- it
// creates whatever seed-uat.mjs would have skipped anyway, using the same
// idempotent pattern for accounts/vehicles/booking-options).
//
// This drives every change through the real RPCs (create_request,
// save_schedule_draft, submit_schedule, approve_schedule, ...), signed in
// as each seed persona -- exactly what the app itself does -- so triggers,
// checks and in-app notifications all fire for real, not just direct table
// inserts. Reads Supabase credentials from .env.local, same as
// seed-uat.mjs. Local Supabase only: this script does not check which
// project .env.local points at, so don't point it at a project with real
// data.
//
// Usage: node scripts/seed-v2-demo.mjs
//
// Not idempotent for the demo data itself (accounts/vehicles/booking
// options are skip-if-exists; requests/schedules are always created fresh)
// -- re-running adds a second batch rather than erroring, which is fine for
// a manual demo seed but means running it twice doubles the list sizes.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].trim();
  }
}
loadEnvLocal();

const PASSWORD = "test1234";
const AUTH_EMAIL_DOMAIN = "accounts.kova.internal";
const usernameToAuthEmail = (username) => `${username.toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- date helpers (Asia/Manila calendar days, matching check_request_date) ----
function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
const TODAY = manilaToday();

// ---- accounts / vehicles / booking options (idempotent, same as seed-uat.mjs) ----
const ACCOUNTS = [
  { username: "admin1", name: "QA Admin", role: "Admin" },
  { username: "sched1", name: "QA Scheduler", role: "Scheduler" },
  { username: "req1", name: "QA Requester One", role: "Requester" },
  { username: "req2", name: "QA Requester Two", role: "Requester" },
  { username: "driver1", name: "QA Driver One", role: "Driver" },
  { username: "driver2", name: "QA Driver Two", role: "Driver" },
];

const BOOKING_OPTIONS = [
  { group: "projects", id: "uat-project", name: "UAT Project" },
  { group: "destinations", id: "uat-dest-a", name: "Site Alpha" },
  { group: "destinations", id: "uat-dest-b", name: "Site Beta" },
  { group: "destinations", id: "uat-dest-fuel", name: "Fuel Stop", isOtherStop: true },
  { group: "purposes", id: "uat-purpose-delivery", name: "Delivery" },
  { group: "purposes", id: "uat-purpose-pickup", name: "Pickup" },
];

async function seedAccount({ username, name, role }) {
  const { data: existing } = await admin.from("accounts").select("id").eq("username", username).maybeSingle();
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD });
    if (error) throw new Error(`password reset(${username}) failed: ${error.message}`);
    return existing.id;
  }
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: usernameToAuthEmail(username),
    password: PASSWORD,
    email_confirm: true,
  });
  if (createError || !created.user) throw new Error(`auth.createUser(${username}) failed: ${createError?.message}`);
  const { error: insertError } = await admin
    .from("accounts")
    .insert({ id: created.user.id, username, name, role, status: "Active", project: null });
  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new Error(`accounts insert(${username}) failed: ${insertError.message}`);
  }
  console.log(`created account ${username} (${role})`);
  return created.user.id;
}

async function seedVehicle(plate, name, assignedDriverId) {
  const { data: existing } = await admin.from("vehicles").select("plate").eq("plate", plate).maybeSingle();
  if (existing) {
    await admin.from("vehicles").update({ assigned_driver_id: assignedDriverId }).eq("plate", plate);
    return;
  }
  const { error } = await admin.from("vehicles").insert({ plate, name, status: "Active", assigned_driver_id: assignedDriverId });
  if (error) throw new Error(`vehicles insert(${plate}) failed: ${error.message}`);
  console.log(`created vehicle ${plate}`);
}

async function seedBookingOption({ group, id, name, isOtherStop }) {
  const { data: existing } = await admin.from("booking_options").select("id").eq("group", group).eq("id", id).maybeSingle();
  if (existing) return;
  const { error } = await admin
    .from("booking_options")
    .insert({ group, id, name, status: "Active", is_other_stop: isOtherStop ?? false });
  if (error) throw new Error(`booking_options insert(${group}/${id}) failed: ${error.message}`);
  console.log(`created booking_option ${group}/${id}`);
}

// ---- per-persona authenticated clients (RPCs read auth.uid(), so a real session is required) ----
const clients = new Map();
async function clientFor(username) {
  if (clients.has(username)) return clients.get(username);
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email: usernameToAuthEmail(username), password: PASSWORD });
  if (error) throw new Error(`sign-in(${username}) failed: ${error.message}`);
  clients.set(username, client);
  return client;
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

async function stopsForDestination(requestIds, destinationId) {
  const { data, error } = await admin
    .from("request_destinations")
    .select("id, request_id, destination_id, active")
    .in("request_id", requestIds)
    .eq("destination_id", destinationId)
    .eq("active", true);
  if (error) throw new Error(`request_destinations lookup failed: ${error.message}`);
  return data.map((row) => row.id);
}

/** Builds a one-destination-leg + final-leg-home schedule, matching the app's own leg shape. */
async function legsFor(requestIds, destinationId) {
  const stops = await stopsForDestination(requestIds, destinationId);
  return [
    { destinationId, plannedTimeOut: "08:00", plannedTimeIn: "09:00", contactName: "", contactNumber: "", stops },
    { isFinal: true, plannedTimeOut: "09:15", plannedTimeIn: "10:00" },
  ];
}

/** Creates a request as the given persona. Returns the request row. */
async function createRequest(username, { date, destinationId, purposeId }) {
  const client = await clientFor(username);
  return rpc(client, "create_request", {
    p_requested_date: date,
    p_request_type: "REGULAR",
    p_project_id: "uat-project",
    p_project_other: "",
    p_destinations: [{ destinationId, purposeId }],
  });
}

/** Creates a draft schedule (as sched1, or admin1 for past-date Admin-owned requests) for one or more requests, all going to one destination. */
async function createDraft(schedulerUsername, { date, plate, requestIds, destinationId }) {
  const client = await clientFor(schedulerUsername);
  const legs = await legsFor(requestIds, destinationId);
  return rpc(client, "save_schedule_draft", {
    p_schedule_id: null,
    p_expected_row_version: null,
    p_schedule_date: date,
    p_plate: plate,
    p_request_ids: requestIds,
    p_legs: legs,
  });
}

async function submit(schedulerUsername, scheduleId, rowVersion) {
  const client = await clientFor(schedulerUsername);
  return rpc(client, "submit_schedule", { p_schedule_id: scheduleId, p_expected_row_version: rowVersion });
}

async function approve(scheduleId, rowVersion) {
  const client = await clientFor("admin1");
  return rpc(client, "approve_schedule", { p_schedule_id: scheduleId, p_expected_row_version: rowVersion });
}

async function returnToScheduler(scheduleId, rowVersion, comment) {
  const client = await clientFor("admin1");
  return rpc(client, "return_schedule", { p_schedule_id: scheduleId, p_expected_row_version: rowVersion, p_comment: comment });
}

/** Drives one request through create -> draft -> submit, returning both. */
async function scheduleOneRequest({ requesterUsername, schedulerUsername, date, plate, destinationId, purposeId }) {
  const request = await createRequest(requesterUsername, { date, destinationId, purposeId });
  const draft = await createDraft(schedulerUsername, { date, plate, requestIds: [request.id], destinationId });
  const submitted = await submit(schedulerUsername, draft.schedule_id, draft.row_version);
  return { request, scheduleId: draft.schedule_id, revision: submitted };
}

async function main() {
  console.log(`Seeding against ${SUPABASE_URL} (today = ${TODAY} Asia/Manila)`);

  const ids = {};
  for (const account of ACCOUNTS) ids[account.username] = await seedAccount(account);
  await seedVehicle("UAT-001", "Toyota Hiace (UAT)", ids.driver1);
  await seedVehicle("UAT-002", "Isuzu Crosswind (UAT)", ids.driver2);
  for (const option of BOOKING_OPTIONS) await seedBookingOption(option);

  const destA = "uat-dest-a";
  const destB = "uat-dest-b";
  const purposeDelivery = "uat-purpose-delivery";
  const purposePickup = "uat-purpose-pickup";

  // 1. Not yet scheduled.
  await createRequest("req1", { date: addDays(TODAY, 8), destinationId: destA, purposeId: purposeDelivery });
  console.log("1/14 not-yet-scheduled request created");

  // 2. Scheduling (draft saved, not submitted).
  {
    const date = addDays(TODAY, 9);
    const request = await createRequest("req2", { date, destinationId: destB, purposeId: purposePickup });
    await createDraft("sched1", { date, plate: "UAT-002", requestIds: [request.id], destinationId: destB });
    console.log("2/14 draft (unsubmitted) schedule created");
  }

  // 3. Pending approval (submitted).
  {
    const date = addDays(TODAY, 10);
    await scheduleOneRequest({
      requesterUsername: "req1", schedulerUsername: "sched1", date, plate: "UAT-001",
      destinationId: destA, purposeId: purposeDelivery,
    });
    console.log("3/14 submitted schedule (pending approval) created");
  }

  // 4. Returned (submitted, then Admin sends back with a comment).
  {
    const date = addDays(TODAY, 11);
    const { scheduleId, revision } = await scheduleOneRequest({
      requesterUsername: "req2", schedulerUsername: "sched1", date, plate: "UAT-002",
      destinationId: destB, purposeId: purposePickup,
    });
    await returnToScheduler(scheduleId, revision.row_version, "Please double-check the Time Out against the Driver's other trips.");
    console.log("4/14 returned schedule created");
  }

  // 5. Approved, trip still in the future.
  {
    const date = addDays(TODAY, 12);
    const { scheduleId, revision } = await scheduleOneRequest({
      requesterUsername: "req1", schedulerUsername: "sched1", date, plate: "UAT-001",
      destinationId: destA, purposeId: purposeDelivery,
    });
    await approve(scheduleId, revision.row_version);
    console.log("5/14 approved future schedule created");
  }

  // 6. Approved, then the Requester asks to cancel (pending Admin decision).
  {
    const date = addDays(TODAY, 13);
    const { request, scheduleId, revision } = await scheduleOneRequest({
      requesterUsername: "req2", schedulerUsername: "sched1", date, plate: "UAT-002",
      destinationId: destB, purposeId: purposePickup,
    });
    await approve(scheduleId, revision.row_version);
    const req2Client = await clientFor("req2");
    await rpc(req2Client, "request_cancellation", { p_request_id: request.id, p_reason: "Trip no longer needed." });
    console.log("6/14 pending-cancellation request created");
  }

  // 7. Approved, cancellation requested then declined by Admin.
  {
    const date = addDays(TODAY, 14);
    const { request, scheduleId, revision } = await scheduleOneRequest({
      requesterUsername: "req1", schedulerUsername: "sched1", date, plate: "UAT-001",
      destinationId: destA, purposeId: purposeDelivery,
    });
    await approve(scheduleId, revision.row_version);
    const req1Client = await clientFor("req1");
    const cancellation = await rpc(req1Client, "request_cancellation", {
      p_request_id: request.id, p_reason: "Schedule conflict.",
    });
    const adminClient = await clientFor("admin1");
    await rpc(adminClient, "decline_cancellation", {
      p_cancellation_id: cancellation.id, p_note: "This trip is already fully staffed and can't be released.",
    });
    console.log("7/14 declined-cancellation request created");
  }

  // 8. Two requests sharing one schedule; one is cancelled (confirmed),
  //    leaving the schedule approved but flagged "route needs updating".
  {
    const date = addDays(TODAY, 15);
    const reqA = await createRequest("req1", { date, destinationId: destA, purposeId: purposeDelivery });
    const reqB = await createRequest("req2", { date, destinationId: destA, purposeId: purposePickup });
    const draft = await createDraft("sched1", { date, plate: "UAT-001", requestIds: [reqA.id, reqB.id], destinationId: destA });
    const submitted = await submit("sched1", draft.schedule_id, draft.row_version);
    await approve(draft.schedule_id, submitted.row_version);
    const req1Client = await clientFor("req1");
    const cancellation = await rpc(req1Client, "request_cancellation", {
      p_request_id: reqA.id, p_reason: "Only one of the two stops is still needed.",
    });
    const adminClient = await clientFor("admin1");
    await rpc(adminClient, "confirm_cancellation", { p_cancellation_id: cancellation.id });
    console.log("8/14 partially-cancelled (route needs updating) schedule created");
  }

  // 9. Request cancelled outright, before ever being scheduled.
  {
    const date = addDays(TODAY, 16);
    const request = await createRequest("req2", { date, destinationId: destB, purposeId: purposePickup });
    const req2Client = await clientFor("req2");
    await rpc(req2Client, "cancel_request", { p_request_id: request.id });
    console.log("9/14 outright-cancelled request created");
  }

  // ---- Past-date trips (Admin bypasses the notice deadline), driving completions/problems ----
  async function pastTrip({ daysAgo, plate, destinationId, purposeId }) {
    const date = addDays(TODAY, daysAgo);
    const request = await createRequest("admin1", { date, destinationId, purposeId });
    const draft = await createDraft("sched1", { date, plate, requestIds: [request.id], destinationId });
    const submitted = await submit("sched1", draft.schedule_id, draft.row_version);
    await approve(draft.schedule_id, submitted.row_version);
    return draft.schedule_id;
  }

  // 10. Approved, ended, no completion yet ("Ready to complete").
  {
    await pastTrip({ daysAgo: -2, plate: "UAT-001", destinationId: destA, purposeId: purposeDelivery });
    console.log("10/14 ready-to-complete past trip created");
  }

  // 11. Completed (Driver submitted odometers, not yet marked Done).
  {
    const scheduleId = await pastTrip({ daysAgo: -3, plate: "UAT-002", destinationId: destB, purposeId: purposePickup });
    const driver2 = await clientFor("driver2");
    await rpc(driver2, "submit_completion", {
      p_schedule_id: scheduleId, p_start_odometer: 20500, p_end_odometer: 20550,
      p_full_tank: true, p_fleet_card_used: true, p_gas_receipt_attached: false,
    });
    console.log("11/14 submitted-completion past trip created");
  }

  // 12. Done (Driver submitted, Admin marked Done).
  {
    const scheduleId = await pastTrip({ daysAgo: -4, plate: "UAT-001", destinationId: destA, purposeId: purposeDelivery });
    const driver1 = await clientFor("driver1");
    await rpc(driver1, "submit_completion", {
      p_schedule_id: scheduleId, p_start_odometer: 15000, p_end_odometer: 15042,
      p_full_tank: false, p_fleet_card_used: false, p_gas_receipt_attached: true,
    });
    const adminClient = await clientFor("admin1");
    await rpc(adminClient, "mark_completion_done", { p_schedule_id: scheduleId });
    console.log("12/14 done past trip created");
  }

  // 13. Open problem report (no completion).
  {
    const scheduleId = await pastTrip({ daysAgo: -5, plate: "UAT-002", destinationId: destB, purposeId: purposePickup });
    const driver2 = await clientFor("driver2");
    await rpc(driver2, "report_problem", { p_schedule_id: scheduleId, p_note: "Vehicle had a flat tire near Site Beta." });
    console.log("13/14 open-problem past trip created");
  }

  // 14. Handled problem report.
  {
    const scheduleId = await pastTrip({ daysAgo: -6, plate: "UAT-001", destinationId: destA, purposeId: purposeDelivery });
    const driver1 = await clientFor("driver1");
    const problem = await rpc(driver1, "report_problem", {
      p_schedule_id: scheduleId, p_note: "Traffic rerouted the trip, arrived over an hour late.",
    });
    const adminClient = await clientFor("admin1");
    await rpc(adminClient, "handle_problem", {
      p_problem_id: problem.id, p_handling_note: "Noted for future scheduling; no action needed.", p_follow_up_schedule_id: null,
    });
    console.log("14/14 handled-problem past trip created");
  }

  console.log("\nDone. Sign in as admin1 / sched1 / req1 / req2 / driver1 / driver2, password: test1234");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

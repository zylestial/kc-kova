// Seeds a trip to change while it's on the road (Change route, 0060), so the
// Driver side and Scheduling can be clicked through:
//
//   driver4 (on UAT-004, so it never overlaps the other demos) gets an
//   approved, unstarted trip today: ANONANG -> Site Alpha -> Site Beta ->
//   ANONANG, leaving at the next quarter hour. It serves one request of
//   three stops: two at Site Alpha (cement, rebar), on one leg, so a stop
//   report can name just one (0067), and one at Site Beta.
//   A waiting Urgent stop at Site Gamma today, for sched1 to add to it once
//   it's on the road (Fit it in, or drag it onto UAT-004).
//
// Accounts, vehicles and booking options are created skip-if-exists (password
// test1234), as in seed-stop-times-demo.mjs.
//
// Local only (.env.local). Runs once per day: a second run the same day
// stops, since UAT-004 already has its trip, unless it's run with --fresh:
// that first cancels today's UAT-004 trip and the demo's requests (and
// closes their problem reports), then seeds again.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envFile = new URL("../.env.local", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].trim();
  }
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(SUPABASE_URL)) {
  console.error(`${SUPABASE_URL} is not local. This demo is for local Supabase only.`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "test1234";
const PLATE = "UAT-004";
const usernameToAuthEmail = (username) => `${username.toLowerCase()}@accounts.kova.internal`;

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
/** "HH:MM" in Manila, `minutes` from the next quarter hour (8 AM if that's late in the evening). */
function fromNext(minutes) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date())
    .split(":")
    .map(Number);
  let start = Math.ceil((h * 60 + m + 1) / 15) * 15;
  if (start > 21 * 60) start = 8 * 60;
  const total = start + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// ---- places: Site Alpha ~1.2 km north of ANONANG, Site Beta ~2 km east, Site Gamma ~1.5 km south ----
const ALPHA = { lat: 16.114569, lng: 120.436222 };
const BETA = { lat: 16.103769, lng: 120.454922 };
const GAMMA = { lat: 16.090269, lng: 120.436222 };

const ACCOUNTS = [
  { username: "admin1", name: "QA Admin", role: "Admin" },
  { username: "sched1", name: "QA Scheduler", role: "Scheduler" },
  { username: "driver4", name: "QA Driver Four", role: "Driver" },
];
const OPTIONS = [
  { group: "projects", id: "uat-project", name: "UAT Project" },
  { group: "destinations", id: "uat-dest-a", name: "Site Alpha", place: ALPHA },
  { group: "destinations", id: "uat-dest-b", name: "Site Beta", place: BETA },
  { group: "destinations", id: "uat-dest-c", name: "Site Gamma", place: GAMMA },
  { group: "purposes", id: "uat-purpose-delivery", name: "Delivery" },
];

async function seedAccount({ username, name, role }) {
  const { data: existing, error } = await admin.from("accounts").select("id").eq("username", username).maybeSingle();
  if (error) throw new Error(`accounts lookup(${username}) failed: ${error.message}`);
  if (existing) return existing.id;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: usernameToAuthEmail(username),
    password: PASSWORD,
    email_confirm: true,
  });
  if (createError || !created.user) throw new Error(`createUser(${username}) failed: ${createError?.message}`);
  // Tour seen (0084), so it doesn't open over the demo trip (e2e/offline-taps).
  const { error: insertError } = await admin
    .from("accounts")
    .insert({ id: created.user.id, username, name, role, status: "Active", tour_seen_at: new Date().toISOString() });
  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new Error(`accounts insert(${username}) failed: ${insertError.message}`);
  }
  console.log(`created account ${username} (${role})`);
  return created.user.id;
}

async function seedVehicle(plate, name, driverId) {
  await admin.from("vehicles").update({ assigned_driver_id: null }).eq("assigned_driver_id", driverId);
  const { data: existing } = await admin.from("vehicles").select("plate").eq("plate", plate).maybeSingle();
  const { error } = existing
    ? await admin.from("vehicles").update({ name, assigned_driver_id: driverId, status: "Active" }).eq("plate", plate)
    : await admin.from("vehicles").insert({ plate, name, status: "Active", assigned_driver_id: driverId });
  if (error) throw new Error(`vehicle ${plate} failed: ${error.message}`);
}

/** Creates the option if missing; a destination's location (0044) is always (re)set. */
async function seedOption({ group, id, name, place }) {
  const { data: existing } = await admin.from("booking_options").select("id").eq("group", group).eq("id", id).maybeSingle();
  if (!existing) {
    const { error } = await admin.from("booking_options").insert({ group, id, name, status: "Active", is_other_stop: false });
    if (error) throw new Error(`booking_options ${group}/${id} failed: ${error.message}`);
  }
  if (!place) return;
  const { error } = await admin
    .from("destination_locations")
    .upsert({ destination_id: id, lat: place.lat, lng: place.lng }, { onConflict: "destination_group,destination_id" });
  if (error) throw new Error(`destination_locations ${id} failed: ${error.message}`);
}

const clients = new Map();
async function clientFor(username) {
  if (!clients.has(username)) {
    const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email: usernameToAuthEmail(username), password: PASSWORD });
    if (error) throw new Error(`sign-in(${username}) failed: ${error.message}`);
    clients.set(username, client);
  }
  return clients.get(username);
}
async function rpc(username, name, args) {
  const { data, error } = await (await clientFor(username)).rpc(name, args);
  if (error) throw new Error(`${name} as ${username} failed: ${error.message}`);
  return data;
}

/** An Urgent request for today, filed by admin1, to these destinations. */
async function urgentRequest(destinationIds) {
  const request = await rpc("admin1", "create_request", {
    p_requested_date: TODAY,
    p_request_type: "URGENT",
    p_project_id: "uat-project",
    p_project_other: "",
    p_destinations: destinationIds.map((destinationId) => ({ destinationId, purposeId: "uat-purpose-delivery" })),
    p_vehicle_plate: null,
  });
  const { data: stops, error } = await admin
    .from("request_destinations")
    .select("id, position")
    .eq("request_id", request.id)
    .eq("active", true)
    .order("position");
  if (error) throw new Error(`request_destinations lookup failed: ${error.message}`);
  return { request, stops };
}

/** A Daily request of these stops for today, filed by admin1: one request per stop, A first. */
async function groupRequest(stops) {
  const group = await rpc("admin1", "create_request_group", {
    p_form_type: "DAILY",
    p_input: {
      date: TODAY,
      stops: stops.map(({ destinationId, details }) => ({
        projectId: "uat-project",
        destinationId,
        purposeId: "uat-purpose-delivery",
        details,
        flexibility: "DAY",
      })),
    },
  });
  const { data, error } = await admin
    .from("requests")
    .select("id, stop_letter, request_destinations(id)")
    .eq("group_id", group.id)
    .order("stop_letter");
  if (error) throw new Error(`request group lookup failed: ${error.message}`);
  return data.map((request) => ({ id: request.id, stopId: request.request_destinations[0].id }));
}

/** --fresh: cancels today's UAT-004 trips and this demo's requests, as if they never ran. */
async function clearToday(adminId) {
  const { data: trips, error } = await admin
    .from("schedules")
    .select("id, schedule_revisions!schedule_revisions_schedule_id_fkey!inner(plate, revision_requests(request_id))")
    .eq("schedule_date", TODAY)
    .eq("status", "ACTIVE")
    .eq("schedule_revisions.plate", PLATE);
  if (error) throw new Error(`schedule lookup failed: ${error.message}`);
  const scheduleIds = trips.map((trip) => trip.id);
  const { data: waiting, error: waitingError } = await admin
    .from("requests")
    .select("id, request_destinations!inner(destination_id)")
    // Today's, and any a test moved to a later day (0065).
    .gte("requested_date", TODAY)
    .eq("owner_account_id", adminId)
    .eq("status", "ACTIVE")
    .in("request_destinations.destination_id", ["uat-dest-a", "uat-dest-b", "uat-dest-c"]);
  if (waitingError) throw new Error(`request lookup failed: ${waitingError.message}`);
  const requestIds = [
    ...new Set([
      ...trips.flatMap((trip) => trip.schedule_revisions.flatMap((revision) => (revision.revision_requests ?? []).map((item) => item.request_id))),
      ...waiting.map((request) => request.id),
    ]),
  ];
  const now = new Date().toISOString();
  const steps = [
    scheduleIds.length && admin.from("schedule_reservations").delete().in("schedule_id", scheduleIds),
    scheduleIds.length &&
      admin.from("schedule_requests").update({ active: false, released_at: now, released_by_account_id: adminId }).in("schedule_id", scheduleIds).eq("active", true),
    scheduleIds.length &&
      admin
        .from("problem_reports")
        .update({ status: "HANDLED", handled_at: now, handled_by_account_id: adminId, handling_note: "Demo reset" })
        .in("schedule_id", scheduleIds)
        .eq("status", "OPEN"),
    scheduleIds.length && admin.from("schedules").update({ status: "CANCELLED", paused_at: null, updated_at: now }).in("id", scheduleIds),
    requestIds.length &&
      admin.from("requests").update({ status: "CANCELLED", cancelled_at: now, cancelled_by_account_id: adminId }).in("id", requestIds).eq("status", "ACTIVE"),
  ];
  for (const step of steps.filter(Boolean)) {
    const { error: stepError } = await step;
    if (stepError) throw new Error(`--fresh failed: ${stepError.message}`);
  }
  console.log(`--fresh: cancelled ${scheduleIds.length} trip(s) on ${PLATE} and ${requestIds.length} request(s) from earlier runs today`);
}

async function main() {
  console.log(`Seeding the on-the-road demo into ${SUPABASE_URL} (today ${TODAY}, Asia/Manila)`);
  const ids = {};
  for (const account of ACCOUNTS) ids[account.username] = await seedAccount(account);
  await seedVehicle(PLATE, "Nissan Urvan (UAT)", ids.driver4);
  for (const option of OPTIONS) await seedOption(option);

  const { data: already, error } = await admin
    .from("schedules")
    .select("id, schedule_revisions!schedule_revisions_schedule_id_fkey!inner(plate)")
    .eq("schedule_date", TODAY)
    .eq("status", "ACTIVE")
    .eq("schedule_revisions.plate", PLATE);
  if (error) throw new Error(`schedule check failed: ${error.message}`);
  if (process.argv.includes("--fresh")) {
    await clearToday(ids.admin1);
  } else if (already.length) {
    console.error(`${PLATE} already has a trip today: this demo has run today. Run it with --fresh to start over. Stopping.`);
    process.exit(1);
  }

  // Today's trip: ANONANG -> Site Alpha -> Site Beta -> ANONANG, approved.
  // One request per stop, as the app makes them since 0052, so a missed
  // stop can come off the trip on its own (release_missed_stop).
  const [cement, rebar, beta] = await groupRequest([
    { destinationId: "uat-dest-a", details: "Cement, 20 bags" },
    { destinationId: "uat-dest-a", details: "Rebar, 10 pcs" },
    { destinationId: "uat-dest-b", details: "Paint, 4 gallons" },
  ]);
  const draft = await rpc("sched1", "save_schedule_draft", {
    p_schedule_id: null,
    p_expected_row_version: null,
    p_schedule_date: TODAY,
    p_plate: PLATE,
    p_request_ids: [cement.id, rebar.id, beta.id],
    p_legs: [
      { destinationId: "uat-dest-a", plannedTimeOut: fromNext(0), plannedTimeIn: fromNext(30), contactName: "", contactNumber: "", stops: [cement.stopId, rebar.stopId] },
      { destinationId: "uat-dest-b", plannedTimeOut: fromNext(60), plannedTimeIn: fromNext(90), contactName: "", contactNumber: "", stops: [beta.stopId] },
      { isFinal: true, plannedTimeOut: fromNext(120), plannedTimeIn: fromNext(150) },
    ],
  });
  const submitted = await rpc("sched1", "submit_schedule", { p_schedule_id: draft.schedule_id, p_expected_row_version: draft.row_version });
  await rpc("admin1", "approve_schedule", { p_schedule_id: draft.schedule_id, p_expected_row_version: submitted.row_version });
  console.log(`today: approved trip for driver4 on ${PLATE}, Site Alpha -> Site Beta, leaving ${fromNext(0)} (not started)`);

  // A stop still waiting, to add once the trip is on the road.
  await urgentRequest(["uat-dest-c"]);
  console.log("today: one Urgent stop at Site Gamma waiting in To plan");

  console.log("\nDone. Sign in as driver4 (My Schedule), sched1 (Scheduling) or admin1; password: test1234");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

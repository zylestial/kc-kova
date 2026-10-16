// Seeds a week of Driver attendance (Start/End taps at ANONANG) so the
// Attendance screen and My Schedule can be clicked through: clean days, a
// return away from base, a tap without a location, a late tap, a trip
// started but never ended, one never started, one tapped by an Admin, and
// today's trips left unstarted to tap live from a phone.
//
// Accounts, vehicles and booking options are created skip-if-exists, same
// as seed-uat.mjs (password test1234). Trips go through the real RPCs as
// each persona. Past taps can't: record_trip_attendance always stamps the
// current time, so those rows are written with the service role and
// backdated. Today's trips are left for real taps.
//
// Targets .env.local (local Supabase) by default. For a hosted project,
// pass its credentials as environment variables (from the Supabase
// dashboard; never paste them into chat) and add --confirm:
//
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_ANON_KEY=<anon key> \
//   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
//   node scripts/seed-attendance-demo.mjs --confirm
//
// Only for a project without real data: it adds demo accounts with a known
// password. Clear them before real users start. Runs once per day: a second
// run the same day stops, since the trips would overlap the first run's.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL) {
  const envFile = new URL("../.env.local", import.meta.url);
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) process.env[match[1]] ??= match[2].trim();
    }
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (or fill .env.local).");
  process.exit(1);
}
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(SUPABASE_URL);
if (!isLocal && !process.argv.includes("--confirm")) {
  console.error(`${SUPABASE_URL} is not local. Re-run with --confirm to seed demo data there.`);
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "test1234";
const usernameToAuthEmail = (username) => `${username.toLowerCase()}@accounts.kova.internal`;

// ---- dates (Asia/Manila calendar days) ----
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** A Manila wall-clock time on `date` as an ISO timestamp. */
const at = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();

// ---- positions: ANONANG and a spot about 1.2 km north of it ----
const BASE = { lat: 16.103769, lng: 120.436222 };
const AWAY = { lat: 16.114569, lng: 120.436222 };
/** A point near `place`, a few metres off, like a real phone reading. */
const near = (place, metresNorth = 12, metresEast = 8) => ({
  lat: place.lat + metresNorth / 111_320,
  lng: place.lng + metresEast / (111_320 * Math.cos((place.lat * Math.PI) / 180)),
});
/** Same haversine as distance_from_base_m (migration 0042). */
function distanceFromBase({ lat, lng }) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const a =
    Math.sin(rad(lat - BASE.lat) / 2) ** 2 + Math.cos(rad(BASE.lat)) * Math.cos(rad(lat)) * Math.sin(rad(lng - BASE.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

// ---- accounts, vehicles, options (skip if they exist; same as seed-uat.mjs) ----
const ACCOUNTS = [
  { username: "admin1", name: "QA Admin", role: "Admin" },
  { username: "sched1", name: "QA Scheduler", role: "Scheduler" },
  { username: "driver1", name: "QA Driver One", role: "Driver" },
  { username: "driver2", name: "QA Driver Two", role: "Driver" },
];
const OPTIONS = [
  { group: "projects", id: "uat-project", name: "UAT Project" },
  { group: "destinations", id: "uat-dest-a", name: "Site Alpha" },
  { group: "destinations", id: "uat-dest-b", name: "Site Beta" },
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
  const { error: insertError } = await admin.from("accounts").insert({ id: created.user.id, username, name, role, status: "Active" });
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
    ? await admin.from("vehicles").update({ assigned_driver_id: driverId, status: "Active" }).eq("plate", plate)
    : await admin.from("vehicles").insert({ plate, name, status: "Active", assigned_driver_id: driverId });
  if (error) throw new Error(`vehicle ${plate} failed: ${error.message}`);
}

async function seedOption({ group, id, name }) {
  const { data: existing } = await admin.from("booking_options").select("id").eq("group", group).eq("id", id).maybeSingle();
  if (existing) return;
  const { error } = await admin.from("booking_options").insert({ group, id, name, status: "Active", is_other_stop: false });
  if (error) throw new Error(`booking_options ${group}/${id} failed: ${error.message}`);
}

// ---- signed-in clients: the RPCs read auth.uid() ----
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

/** An Admin-requested, Scheduler-planned, Admin-approved trip on `date`. Returns the schedule and its approved version. */
async function approvedTrip(date, plate, destinationId) {
  const urgent = date >= TODAY && date < addDays(TODAY, 7);
  const request = await rpc("admin1", "create_request", {
    p_requested_date: date,
    p_request_type: urgent ? "URGENT" : "REGULAR",
    p_project_id: "uat-project",
    p_project_other: "",
    p_destinations: [{ destinationId, purposeId: "uat-purpose-delivery" }],
    p_vehicle_plate: null,
  });
  const { data: stops, error } = await admin
    .from("request_destinations")
    .select("id")
    .eq("request_id", request.id)
    .eq("active", true);
  if (error) throw new Error(`request_destinations lookup failed: ${error.message}`);
  const draft = await rpc("sched1", "save_schedule_draft", {
    p_schedule_id: null,
    p_expected_row_version: null,
    p_schedule_date: date,
    p_plate: plate,
    p_request_ids: [request.id],
    p_legs: [
      { destinationId, plannedTimeOut: "08:00", plannedTimeIn: "09:00", contactName: "", contactNumber: "", stops: stops.map((s) => s.id) },
      { isFinal: true, plannedTimeOut: "09:30", plannedTimeIn: "10:30" },
    ],
  });
  const submitted = await rpc("sched1", "submit_schedule", { p_schedule_id: draft.schedule_id, p_expected_row_version: draft.row_version });
  await rpc("admin1", "approve_schedule", { p_schedule_id: draft.schedule_id, p_expected_row_version: submitted.row_version });
  return { scheduleId: draft.schedule_id, revisionId: draft.id };
}

/** One backdated tap's columns: `place` null means the phone shared no position. */
function tap(prefix, time, place, recordedBy) {
  return {
    [`${prefix}_at`]: time,
    [`${prefix}_lat`]: place?.lat ?? null,
    [`${prefix}_lng`]: place?.lng ?? null,
    [`${prefix}_accuracy_m`]: place ? 14 : null,
    [`${prefix}_distance_m`]: place ? distanceFromBase(place) : null,
    [`${prefix}_recorded_by_account_id`]: recordedBy,
  };
}

/**
 * Backdated Arrived/Leaving at the trip's one stop (0045), without a
 * position: marking a trip Done needs every Time Out and Time In (0046).
 */
async function writeStopTaps(trip, driverId, arrivedAt, leftAt) {
  const { data: legs, error } = await admin.from("schedule_legs").select("id").eq("revision_id", trip.revisionId).order("leg_no");
  if (error) throw new Error(`schedule_legs lookup failed: ${error.message}`);
  const row = (kind, time) => ({
    schedule_id: trip.scheduleId,
    revision_id: trip.revisionId,
    leg_id: legs[0].id,
    driver_id: driverId,
    kind,
    at: time,
    recorded_by_account_id: driverId,
  });
  const { error: insertError } = await admin.from("stop_taps").insert([row("ARRIVE", arrivedAt), row("LEAVE", leftAt)]);
  if (insertError) throw new Error(`stop_taps insert failed: ${insertError.message}`);
}

async function writeAttendance(trip, driverId, start, end) {
  const { error } = await admin
    .from("trip_attendance")
    .insert({ schedule_id: trip.scheduleId, revision_id: trip.revisionId, driver_id: driverId, ...start, ...(end ?? {}) });
  if (error) throw new Error(`trip_attendance insert failed: ${error.message}`);
}

async function main() {
  console.log(`Seeding attendance demo into ${SUPABASE_URL} (today ${TODAY}, Asia/Manila)`);

  const ids = {};
  for (const account of ACCOUNTS) ids[account.username] = await seedAccount(account);
  await seedVehicle("UAT-001", "Toyota Hiace (UAT)", ids.driver1);
  await seedVehicle("UAT-002", "Isuzu Crosswind (UAT)", ids.driver2);
  for (const option of OPTIONS) await seedOption(option);

  const { data: already, error } = await admin
    .from("schedules")
    .select("id, schedule_revisions!schedule_revisions_schedule_id_fkey!inner(plate)")
    .eq("schedule_date", TODAY)
    .eq("status", "ACTIVE")
    .in("schedule_revisions.plate", ["UAT-001", "UAT-002"]);
  if (error) throw new Error(`schedule check failed: ${error.message}`);
  if (already.length) {
    console.error("UAT-001/UAT-002 already have trips today: this demo has run today. Stopping.");
    process.exit(1);
  }

  const { driver1, driver2 } = ids;
  const day = (n) => addDays(TODAY, -n);

  // 6 days ago: a clean day, submitted; and a return 1.2 km from base, submitted.
  {
    const trip = await approvedTrip(day(6), "UAT-001", "uat-dest-a");
    await writeAttendance(trip, driver1, tap("start", at(day(6), "07:52"), near(BASE), driver1), tap("end", at(day(6), "10:41"), near(BASE, -9, 15), driver1));
    await rpc("driver1", "submit_completion", { p_schedule_id: trip.scheduleId, p_start_odometer: 15000, p_end_odometer: 15042 });
    const away = await approvedTrip(day(6), "UAT-002", "uat-dest-b");
    await writeAttendance(away, driver2, tap("start", at(day(6), "07:58"), near(BASE, 20, -5), driver2), tap("end", at(day(6), "10:52"), near(AWAY), driver2));
    await rpc("driver2", "submit_completion", { p_schedule_id: away.scheduleId, p_start_odometer: 20500, p_end_odometer: 20537 });
    console.log("6 days ago: clean (driver1), ended away from base (driver2)");
  }

  // 5 days ago: a start the phone gave no position for; and a trip never started.
  {
    const trip = await approvedTrip(day(5), "UAT-001", "uat-dest-b");
    await writeAttendance(trip, driver1, tap("start", at(day(5), "07:49"), null, driver1), tap("end", at(day(5), "10:36"), near(BASE), driver1));
    await approvedTrip(day(5), "UAT-002", "uat-dest-a");
    console.log("5 days ago: no location at start (driver1), never started (driver2)");
  }

  // 4 days ago: started, never ended; and an End tapped the next morning.
  {
    const trip = await approvedTrip(day(4), "UAT-001", "uat-dest-a");
    await writeAttendance(trip, driver1, tap("start", at(day(4), "07:55"), near(BASE, 5, 5), driver1));
    const late = await approvedTrip(day(4), "UAT-002", "uat-dest-b");
    await writeAttendance(late, driver2, tap("start", at(day(4), "07:51"), near(BASE), driver2), tap("end", at(day(3), "07:40"), near(BASE, 3, 10), driver2));
    console.log("4 days ago: not ended (driver1), ended the next day (driver2)");
  }

  // 3 days ago: an Admin tapped for driver1; driver2 clean, submitted and Done.
  {
    const trip = await approvedTrip(day(3), "UAT-001", "uat-dest-b");
    await writeAttendance(trip, driver1, tap("start", at(day(3), "08:02"), near(BASE), ids.admin1), tap("end", at(day(3), "10:44"), near(BASE), ids.admin1));
    const done = await approvedTrip(day(3), "UAT-002", "uat-dest-a");
    await writeAttendance(done, driver2, tap("start", at(day(3), "07:47"), near(BASE, -6, 4), driver2), tap("end", at(day(3), "10:33"), near(BASE), driver2));
    await writeStopTaps(done, driver2, at(day(3), "08:41"), at(day(3), "09:36"));
    await rpc("driver2", "submit_completion", { p_schedule_id: done.scheduleId, p_start_odometer: 20537, p_end_odometer: 20571 });
    await rpc("admin1", "mark_completion_done", { p_schedule_id: done.scheduleId });
    console.log("3 days ago: tapped by Admin (driver1), clean and Done (driver2)");
  }

  // Today: both trips unstarted, to tap Start/End live.
  await approvedTrip(TODAY, "UAT-001", "uat-dest-a");
  await approvedTrip(TODAY, "UAT-002", "uat-dest-b");
  console.log("today: one unstarted trip each for driver1 and driver2");

  console.log("\nDone. Sign in as admin1 (Attendance) or driver1 / driver2 (My Schedule); password: test1234");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

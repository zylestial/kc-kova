// Seeds stop-time demo trips (Arrived/Leaving at each stop, 0045) so My
// Schedule, Attendance, Finished Trips and the printed form can be clicked
// through: Site Alpha and Site Beta get a saved location, and driver3 (on
// UAT-003, so it never overlaps the other demos) gets two-stop trips
// (ANONANG -> Site Alpha -> Site Beta -> ANONANG):
//
//   yesterday  every tap made, submitted (one Arrived 900 m off the site)
//   2 days ago Leaving Site Alpha never tapped, submitted (Admin fills it in)
//   today      unstarted, 1:00-5:00 PM, to tap Start, Arrived, Leaving and
//              End live and complete it before its planned end
//
// Accounts, vehicles and booking options are created skip-if-exists (password
// test1234), as in seed-attendance-demo.mjs. Past taps are written with the
// service role and backdated, since the RPCs always stamp the current time.
//
// Local only (.env.local). Runs once per day: a second run the same day
// stops, since the trips would overlap the first run's.

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
const usernameToAuthEmail = (username) => `${username.toLowerCase()}@accounts.kova.internal`;

const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
function addDays(date, days) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
/** A Manila wall-clock time on `date` as an ISO timestamp. */
const at = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();

// ---- places: ANONANG, Site Alpha ~1.2 km north, Site Beta ~2 km east ----
const BASE = { lat: 16.103769, lng: 120.436222 };
const ALPHA = { lat: 16.114569, lng: 120.436222 };
const BETA = { lat: 16.103769, lng: 120.454922 };
const near = (place, metresNorth = 12, metresEast = 8) => ({
  lat: place.lat + metresNorth / 111_320,
  lng: place.lng + metresEast / (111_320 * Math.cos((place.lat * Math.PI) / 180)),
});
/** Same haversine as distance_m (migration 0044). */
function distance(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const h = Math.sin(rad(a.lat - b.lat) / 2) ** 2 + Math.cos(rad(b.lat)) * Math.cos(rad(a.lat)) * Math.sin(rad(a.lng - b.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

const ACCOUNTS = [
  { username: "admin1", name: "QA Admin", role: "Admin" },
  { username: "sched1", name: "QA Scheduler", role: "Scheduler" },
  { username: "driver3", name: "QA Driver Three", role: "Driver" },
];
const OPTIONS = [
  { group: "projects", id: "uat-project", name: "UAT Project" },
  { group: "destinations", id: "uat-dest-a", name: "Site Alpha", place: ALPHA },
  { group: "destinations", id: "uat-dest-b", name: "Site Beta", place: BETA },
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

/**
 * An approved ANONANG -> Site Alpha -> Site Beta -> ANONANG trip on `date`,
 * leaving at 08:00, or at 13:00 with `afternoon` (back by 17:00, so a live
 * trip can be completed before its planned end); returns its ids and leg ids.
 */
async function approvedTrip(date, plate, afternoon = false) {
  const [out1, in1, out2, in2, out3, in3] = afternoon
    ? ["13:00", "13:30", "14:30", "15:00", "16:00", "17:00"]
    : ["08:00", "08:30", "09:30", "10:00", "11:00", "11:30"];
  const urgent = date >= TODAY && date < addDays(TODAY, 7);
  const request = await rpc("admin1", "create_request", {
    p_requested_date: date,
    p_request_type: urgent ? "URGENT" : "REGULAR",
    p_project_id: "uat-project",
    p_project_other: "",
    p_destinations: [
      { destinationId: "uat-dest-a", purposeId: "uat-purpose-delivery" },
      { destinationId: "uat-dest-b", purposeId: "uat-purpose-delivery" },
    ],
    p_vehicle_plate: null,
  });
  const { data: stops, error } = await admin
    .from("request_destinations")
    .select("id, position")
    .eq("request_id", request.id)
    .eq("active", true)
    .order("position");
  if (error) throw new Error(`request_destinations lookup failed: ${error.message}`);
  const draft = await rpc("sched1", "save_schedule_draft", {
    p_schedule_id: null,
    p_expected_row_version: null,
    p_schedule_date: date,
    p_plate: plate,
    p_request_ids: [request.id],
    p_legs: [
      { destinationId: "uat-dest-a", plannedTimeOut: out1, plannedTimeIn: in1, contactName: "", contactNumber: "", stops: [stops[0].id] },
      { destinationId: "uat-dest-b", plannedTimeOut: out2, plannedTimeIn: in2, contactName: "", contactNumber: "", stops: [stops[1].id] },
      { isFinal: true, plannedTimeOut: out3, plannedTimeIn: in3 },
    ],
  });
  const submitted = await rpc("sched1", "submit_schedule", { p_schedule_id: draft.schedule_id, p_expected_row_version: draft.row_version });
  await rpc("admin1", "approve_schedule", { p_schedule_id: draft.schedule_id, p_expected_row_version: submitted.row_version });
  const { data: legs, error: legsError } = await admin.from("schedule_legs").select("id").eq("revision_id", draft.id).order("leg_no");
  if (legsError) throw new Error(`schedule_legs lookup failed: ${legsError.message}`);
  return { scheduleId: draft.schedule_id, revisionId: draft.id, legIds: legs.map((leg) => leg.id) };
}

/** Backdated Start/End, then the stop taps given as [legIndex, kind, time, position, destination]. */
async function writeTaps(trip, driverId, date, startTime, endTime, stopTaps) {
  const start = near(BASE);
  const end = near(BASE, -6, 10);
  const { error } = await admin.from("trip_attendance").insert({
    schedule_id: trip.scheduleId,
    revision_id: trip.revisionId,
    driver_id: driverId,
    start_at: at(date, startTime),
    start_lat: start.lat,
    start_lng: start.lng,
    start_accuracy_m: 12,
    start_distance_m: distance(start, BASE),
    start_recorded_by_account_id: driverId,
    end_at: at(date, endTime),
    end_lat: end.lat,
    end_lng: end.lng,
    end_accuracy_m: 15,
    end_distance_m: distance(end, BASE),
    end_recorded_by_account_id: driverId,
  });
  if (error) throw new Error(`trip_attendance insert failed: ${error.message}`);
  const rows = stopTaps.map(([legIndex, kind, time, position, destination]) => ({
    schedule_id: trip.scheduleId,
    revision_id: trip.revisionId,
    leg_id: trip.legIds[legIndex],
    driver_id: driverId,
    kind,
    at: at(date, time),
    lat: position.lat,
    lng: position.lng,
    accuracy_m: 14,
    distance_m: distance(position, destination),
    recorded_by_account_id: driverId,
  }));
  const { error: tapsError } = await admin.from("stop_taps").insert(rows);
  if (tapsError) throw new Error(`stop_taps insert failed: ${tapsError.message}`);
}

async function main() {
  console.log(`Seeding stop-times demo into ${SUPABASE_URL} (today ${TODAY}, Asia/Manila)`);
  const ids = {};
  for (const account of ACCOUNTS) ids[account.username] = await seedAccount(account);
  await seedVehicle("UAT-003", "Mitsubishi L300 (UAT)", ids.driver3);
  for (const option of OPTIONS) await seedOption(option);

  const { data: already, error } = await admin
    .from("schedules")
    .select("id, schedule_revisions!schedule_revisions_schedule_id_fkey!inner(plate)")
    .eq("schedule_date", TODAY)
    .eq("status", "ACTIVE")
    .eq("schedule_revisions.plate", "UAT-003");
  if (error) throw new Error(`schedule check failed: ${error.message}`);
  if (already.length) {
    console.error("UAT-003 already has a trip today: this demo has run today. Stopping.");
    process.exit(1);
  }

  const { driver3 } = ids;
  const yesterday = addDays(TODAY, -1);
  const twoDaysAgo = addDays(TODAY, -2);

  // Yesterday: every tap made; Arrived at Site Beta 900 m short of it.
  {
    const trip = await approvedTrip(yesterday, "UAT-003");
    await writeTaps(trip, driver3, yesterday, "07:56", "11:41", [
      [0, "ARRIVE", "08:34", near(ALPHA), ALPHA],
      [0, "LEAVE", "09:27", near(ALPHA, -10, 4), ALPHA],
      [1, "ARRIVE", "10:06", near(BETA, 0, -900), BETA],
      [1, "LEAVE", "10:58", near(BETA, 6, -3), BETA],
    ]);
    await rpc("driver3", "submit_completion", { p_schedule_id: trip.scheduleId, p_start_odometer: 30000, p_end_odometer: 30011 });
    console.log("yesterday: every stop tapped (one Arrived away from Site Beta), submitted");
  }

  // 2 days ago: Leaving Site Alpha never tapped.
  {
    const trip = await approvedTrip(twoDaysAgo, "UAT-003");
    await writeTaps(trip, driver3, twoDaysAgo, "08:03", "11:52", [
      [0, "ARRIVE", "08:41", near(ALPHA), ALPHA],
      [1, "ARRIVE", "10:12", near(BETA), BETA],
      [1, "LEAVE", "11:05", near(BETA, 4, 4), BETA],
    ]);
    await rpc("driver3", "submit_completion", { p_schedule_id: trip.scheduleId, p_start_odometer: 29989, p_end_odometer: 30000 });
    console.log("2 days ago: Leaving Site Alpha missing, submitted");
  }

  await approvedTrip(TODAY, "UAT-003", true);
  console.log("today: one unstarted two-stop trip for driver3, 1:00-5:00 PM");
  console.log("\nDone. Sign in as driver3 (My Schedule) or admin1 (Attendance, Finished Trips); password: test1234");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

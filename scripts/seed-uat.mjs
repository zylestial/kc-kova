// Seeds the accounts/vehicles/booking-options that docs/QA_ROLE_TESTS.md
// expects to already exist, using the service-role client directly (the
// same path app/api/accounts/route.ts and app/api/vehicles/route.ts use).
// Safe to re-run: every insert is skipped if the row already exists.
//
// Usage: node scripts/seed-uat.mjs
// Reads Supabase credentials from .env.local (same file `next dev` uses).

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

const UAT_PASSWORD = "Uat-Test1234!";
const AUTH_EMAIL_DOMAIN = "accounts.kova.internal";
const usernameToAuthEmail = (username) => `${username.toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const ACCOUNTS = [
  { username: "admin1", name: "QA Admin", role: "Admin" },
  { username: "booker1", name: "QA Booker One", role: "Booker" },
  { username: "booker2", name: "QA Booker Two", role: "Booker" },
  { username: "driver1", name: "QA Driver One", role: "Driver" },
  { username: "driver2", name: "QA Driver Two", role: "Driver" },
];

const VEHICLES = [
  { plate: "UAT-001", name: "Toyota Hiace (UAT)" },
  { plate: "UAT-002", name: "Isuzu Crosswind (UAT)" },
];

const BOOKING_OPTIONS = [
  { group: "projects", id: "uat-project", name: "UAT Project" },
  { group: "destinations", id: "uat-destination", name: "UAT Destination" },
  { group: "purposes", id: "uat-purpose", name: "UAT Purpose" },
];

async function seedAccount({ username, name, role }) {
  const { data: existing } = await admin.from("accounts").select("id").eq("username", username).maybeSingle();
  if (existing) {
    // Reset the password so a re-run always yields a known-good UAT login,
    // even if the account was created by an earlier manual QA pass.
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password: UAT_PASSWORD });
    if (error) throw new Error(`password reset(${username}) failed: ${error.message}`);
    console.log(`account ${username} already exists — password reset`);
    return;
  }
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: usernameToAuthEmail(username),
    password: UAT_PASSWORD,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`auth.createUser(${username}) failed: ${createError?.message}`);
  }
  const { error: insertError } = await admin
    .from("accounts")
    .insert({ id: created.user.id, username, name, role, status: "Active", project: null });
  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw new Error(`accounts insert(${username}) failed: ${insertError.message}`);
  }
  console.log(`created account ${username} (${role})`);
}

async function seedVehicle({ plate, name }) {
  const { data: existing } = await admin.from("vehicles").select("plate").eq("plate", plate).maybeSingle();
  if (existing) {
    console.log(`skip vehicle ${plate} (already exists)`);
    return;
  }
  const { error } = await admin.from("vehicles").insert({ plate, name, status: "Active" });
  if (error) throw new Error(`vehicles insert(${plate}) failed: ${error.message}`);
  console.log(`created vehicle ${plate}`);
}

async function seedBookingOption({ group, id, name }) {
  const { data: existing } = await admin.from("booking_options").select("id").eq("group", group).eq("id", id).maybeSingle();
  if (existing) {
    console.log(`skip booking_option ${group}/${id} (already exists)`);
    return;
  }
  const { error } = await admin.from("booking_options").insert({ group, id, name, status: "Active" });
  if (error) throw new Error(`booking_options insert(${group}/${id}) failed: ${error.message}`);
  console.log(`created booking_option ${group}/${id}`);
}

for (const account of ACCOUNTS) await seedAccount(account);
for (const vehicle of VEHICLES) await seedVehicle(vehicle);
for (const option of BOOKING_OPTIONS) await seedBookingOption(option);

console.log(`\nDone. All seeded accounts use the password: ${UAT_PASSWORD}`);
console.log("Rotate/delete these accounts once UAT is complete.");

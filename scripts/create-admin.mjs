// Creates the first Admin account on an empty KOVA database. After that,
// the Admin creates everyone else in Settings. Refuses to run once any
// Admin exists.
//
// Usage: node scripts/create-admin.mjs
// Prompts for the username, name and password (never printed). Reads the
// Supabase URL and service-role key from the environment, falling back to
// .env.local; to target production, set NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in the shell first. Needs Node 22.18+ (it
// imports the app's password rule from TypeScript).

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { passwordError, PASSWORD_HINT } from "../lib/password-policy.ts";

const envFile = new URL("../.env.local", import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].trim();
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or add them to .env.local).");
  process.exit(1);
}
if (!/^https?:\/\/[^/]+\/?$/.test(url)) {
  console.error(`"${url}" isn't a Project URL. Use the one from Project Settings → API, like https://<ref>.supabase.co`);
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
// Buffers lines, so piped input isn't lost while the database is checked.
const lines = rl[Symbol.asyncIterator]();
let hidden = false;
// Echo nothing while a password is typed.
rl._writeToOutput = (text) => {
  if (!hidden) rl.output.write(text);
  else if (text.includes("\n")) rl.output.write("\n");
};
async function ask(question, { secret = false } = {}) {
  process.stdout.write(question);
  hidden = secret;
  const { value } = await lines.next();
  hidden = false;
  return value ?? "";
}
const askHidden = (question) => ask(question, { secret: true });
function fail(message) {
  console.error(message);
  rl.close();
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// Not a HEAD request: those carry no body, so a failure would have no message.
const { data: admins, error: readError, status } = await admin.from("accounts").select("id").eq("role", "Admin").limit(1);
if (readError) {
  const detail = [readError.message, readError.code, readError.hint].filter(Boolean).join(" · ");
  fail(`Could not read accounts (HTTP ${status}): ${detail.slice(0, 200) || "no details"}. Check the URL and the service_role key.`);
}
if (admins.length) fail("An Admin already exists. Create more accounts in Settings instead.");

console.log(`Creating the first Admin on ${url}\n`);
const username = (await ask("Username: ")).trim();
if (!username || /\s/.test(username)) fail("The username can't be blank or contain spaces.");
const name = (await ask("Display name: ")).trim();
if (!name) fail("The name can't be blank.");
console.log(PASSWORD_HINT);
const password = await askHidden("Password: ");
const problem = passwordError(password, username);
if (problem) fail(problem);
if ((await askHidden("Repeat password: ")) !== password) fail("The passwords don't match.");
if ((await ask(`Create Admin "${username}" (${name})? Type yes: `)).trim().toLowerCase() !== "yes") fail("Cancelled.");
rl.close();

// Same steps as app/api/accounts/route.ts.
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email: `${username.toLowerCase()}@accounts.kova.internal`,
  password,
  email_confirm: true,
});
if (createError || !created.user) fail(`Could not create the sign-in user: ${createError?.message}`);

const { error: insertError } = await admin
  .from("accounts")
  .insert({ id: created.user.id, username, name, role: "Admin", status: "Active" });
if (insertError) {
  await admin.auth.admin.deleteUser(created.user.id);
  fail(`Could not create the account: ${insertError.message}`);
}

console.log(`\nCreated Admin "${username}". Sign in and add everyone else in Settings.`);

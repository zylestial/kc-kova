import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Sign-in attempt limiting backed by the `login_attempts` table, keyed by
 * username. RLS grants no policies on that table, so it is only ever
 * touched here through the service-role client.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function isLoginRateLimited(username: string) {
  const admin = createSupabaseAdminClient();
  const key = username.trim().toLowerCase();
  const { data } = await admin.from("login_attempts").select("count, window_start").eq("key", key).maybeSingle();
  if (!data) return false;
  const withinWindow = Date.now() - new Date(data.window_start).getTime() < WINDOW_MS;
  return withinWindow && data.count >= MAX_ATTEMPTS;
}

export async function recordFailedLogin(username: string) {
  const admin = createSupabaseAdminClient();
  const key = username.trim().toLowerCase();
  const { data } = await admin.from("login_attempts").select("count, window_start").eq("key", key).maybeSingle();
  const withinWindow = !!data && Date.now() - new Date(data.window_start).getTime() < WINDOW_MS;
  if (withinWindow) {
    await admin.from("login_attempts").update({ count: data.count + 1 }).eq("key", key);
  } else {
    await admin.from("login_attempts").upsert({ key, count: 1, window_start: new Date().toISOString() });
  }
}

export async function clearLoginAttempts(username: string) {
  const admin = createSupabaseAdminClient();
  await admin.from("login_attempts").delete().eq("key", username.trim().toLowerCase());
}

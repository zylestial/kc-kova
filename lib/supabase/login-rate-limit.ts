import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Attempt limiting backed by the `login_attempts` table: a count per key
 * within a fixed window. Sign-in keys are usernames; other limits use a
 * "prefix:" key (usernames can't hold a ":"). RLS grants no policies on
 * that table, so it is only ever touched here through the service-role
 * client.
 */
export type Limit = { max: number; windowMs: number };

const MINUTE = 60 * 1000;
/** Failed sign-ins per account; also reset and confirm emails per account. */
export const SIGN_IN_LIMIT: Limit = { max: 5, windowMs: 15 * MINUTE };
/** Failed sign-ins from one network. High, since an office shares one address. */
export const SIGN_IN_IP_LIMIT: Limit = { max: 30, windowMs: 15 * MINUTE };
/** Forgot password requests from one network. */
export const FORGOT_IP_LIMIT: Limit = { max: 30, windowMs: 15 * MINUTE };
/** Invite emails (new and resent) per Admin; a first batch can be 100. */
export const INVITE_LIMIT: Limit = { max: 150, windowMs: 60 * MINUTE };
/** "Send a test" pushes per account. */
export const PUSH_TEST_LIMIT: Limit = { max: 10, windowMs: 60 * MINUTE };

const normalize = (key: string) => key.trim().toLowerCase();

async function current(key: string, limit: Limit) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("login_attempts").select("count, window_start").eq("key", key).maybeSingle();
  const withinWindow = !!data && Date.now() - new Date(data.window_start).getTime() < limit.windowMs;
  return { admin, count: withinWindow ? (data.count as number) : 0, withinWindow };
}

/** How many more attempts `key` has in its window. */
export async function attemptsLeft(key: string, limit: Limit = SIGN_IN_LIMIT) {
  const { count } = await current(normalize(key), limit);
  return Math.max(0, limit.max - count);
}

export async function isLoginRateLimited(key: string, limit: Limit = SIGN_IN_LIMIT) {
  return (await attemptsLeft(key, limit)) === 0;
}

/** Counts `by` attempts against `key`, starting a new window if the last one ran out. */
export async function recordFailedLogin(key: string, limit: Limit = SIGN_IN_LIMIT, by = 1) {
  if (by <= 0) return;
  const normalized = normalize(key);
  const { admin, count, withinWindow } = await current(normalized, limit);
  if (withinWindow) {
    await admin.from("login_attempts").update({ count: count + by }).eq("key", normalized);
  } else {
    await admin.from("login_attempts").upsert({ key: normalized, count: by, window_start: new Date().toISOString() });
  }
}

export async function clearLoginAttempts(key: string) {
  const admin = createSupabaseAdminClient();
  await admin.from("login_attempts").delete().eq("key", normalize(key));
}

/**
 * The caller's IP address as the host reports it (Vercel sets both
 * headers), or null when there is none, so callers skip the per-network
 * limit rather than lump everyone under one key.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || null;
}

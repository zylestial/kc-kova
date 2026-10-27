import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Attempt limiting backed by the `login_attempts` table: a count per key
 * within a fixed window. Sign-in keys are usernames; other limits use a
 * "prefix:" key (usernames can't hold a ":"). RLS grants no policies on
 * that table, so it is only ever touched here through the service-role
 * client.
 *
 * An attempt is taken before it's made, in one step in the database
 * (add_login_attempts, 0082), so requests sent at the same moment can't all
 * slip under the limit: each sees the count the one before it left.
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

/**
 * Adds `by` attempts to `key` (a negative `by` gives them back) and returns
 * its count in the current window. Null when the database couldn't be asked,
 * which callers treat as allowed: a broken limiter mustn't lock everyone out.
 */
async function addAttempts(key: string, by: number, limit: Limit): Promise<number | null> {
  const { data, error } = await createSupabaseAdminClient().rpc("add_login_attempts", {
    p_key: normalize(key),
    p_by: by,
    p_window_seconds: Math.round(limit.windowMs / 1000),
  });
  if (error) {
    console.error("[login-rate-limit] add_login_attempts failed:", error.message);
    return null;
  }
  return data as number;
}

/**
 * Takes `by` attempts from `key`'s allowance before they're made. `ok` when
 * they fit; otherwise they're given straight back, so a refused try doesn't
 * count, and `left` says how many still would fit.
 */
export async function takeAttempts(key: string, limit: Limit = SIGN_IN_LIMIT, by = 1): Promise<{ ok: boolean; left: number }> {
  const count = await addAttempts(key, by, limit);
  if (count === null) return { ok: true, left: limit.max };
  if (count <= limit.max) return { ok: true, left: limit.max - count };
  await addAttempts(key, -by, limit);
  return { ok: false, left: Math.max(0, limit.max - (count - by)) };
}

/** Gives back attempts taken for something that didn't happen or didn't count (a sign-in that worked). */
export async function giveBackAttempts(key: string, limit: Limit = SIGN_IN_LIMIT, by = 1) {
  if (by > 0) await addAttempts(key, -by, limit);
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

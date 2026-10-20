import { createClient } from "@supabase/supabase-js";
import { usernameToAuthEmail } from "@/lib/supabase/accounts";
import { clearLoginAttempts, isLoginRateLimited, recordFailedLogin } from "@/lib/supabase/login-rate-limit";

/**
 * Whether `password` is this account's current password, for changes that
 * need it (My account). Checked with a throwaway client that keeps no
 * cookies, so the real session is untouched; its own session is ended
 * again at once. Wrong tries count toward the same 5-in-15-minutes limit
 * as Sign In.
 */
export async function verifyCurrentPassword(username: string, password: string): Promise<"ok" | "wrong" | "locked"> {
  if (await isLoginRateLimited(username)) return "locked";
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: usernameToAuthEmail(username), password });
  if (error) {
    await recordFailedLogin(username);
    return "wrong";
  }
  await client.auth.signOut({ scope: "local" });
  await clearLoginAttempts(username);
  return "ok";
}

export const PASSWORD_CHECK_MESSAGE = {
  wrong: "Your current password is not right.",
  locked: "Too many wrong passwords. Try again in 15 minutes.",
} as const;

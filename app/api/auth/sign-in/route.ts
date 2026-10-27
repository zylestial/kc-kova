import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/api-route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toAccount, usernameToAuthEmail } from "@/lib/supabase/accounts";
import {
  clearLoginAttempts,
  clientIp,
  giveBackAttempts,
  SIGN_IN_IP_LIMIT,
  takeAttempts,
} from "@/lib/supabase/login-rate-limit";
import { parseWith } from "@/lib/validation";

const signInBody = z.object({ username: z.string().trim().min(1).max(254), password: z.string().min(1) });

const INVALID = "Invalid username, email or password.";

/**
 * The username to sign in as: what was typed, or the username of the
 * account whose confirmed email it is (0072). A username may itself hold
 * an "@", so one that matches no email is still tried as a username.
 */
async function usernameFor(login: string) {
  if (!login.includes("@")) return login;
  const admin = createSupabaseAdminClient();
  const { data: email } = await admin.from("account_emails").select("account_id").eq("email", login.toLowerCase()).maybeSingle();
  if (!email) return login;
  const { data: account } = await admin.from("accounts").select("username").eq("id", email.account_id).maybeSingle();
  return account?.username ?? login;
}

export async function POST(request: Request) {
  const body = parseWith(signInBody, await readJson(request));
  if (!body) {
    return NextResponse.json({ message: "Username or email, and password, are required." }, { status: 422 });
  }
  const { password } = body;
  // Limited per account, whichever way it was typed, and per network, so
  // one password can't be tried against every username.
  const username = await usernameFor(body.username);
  const ip = clientIp(request);
  const ipKey = ip ? `ip:${ip}` : null;

  // Each try is taken from both allowances before it's made, so tries sent
  // at once can't all get through; one that works gives them back.
  const tooMany = () => NextResponse.json({ message: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429 });
  if (ipKey && !(await takeAttempts(ipKey, SIGN_IN_IP_LIMIT)).ok) return tooMany();
  if (!(await takeAttempts(username)).ok) {
    if (ipKey) await giveBackAttempts(ipKey, SIGN_IN_IP_LIMIT);
    return tooMany();
  }

  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: usernameToAuthEmail(username),
    password,
  });
  if (authError || !authData.user) return NextResponse.json({ message: INVALID }, { status: 401 });

  const { data: accountRow } = await supabase.from("accounts").select("*").eq("id", authData.user.id).maybeSingle();
  if (!accountRow || accountRow.status !== "Active") {
    await supabase.auth.signOut();
    const message = accountRow ? "This account is inactive." : INVALID;
    return NextResponse.json({ message }, { status: accountRow ? 403 : 401 });
  }

  await clearLoginAttempts(username);
  if (ipKey) await giveBackAttempts(ipKey, SIGN_IN_IP_LIMIT);
  return NextResponse.json({ account: toAccount(accountRow) });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/api-route";
import { issueAccountToken } from "@/lib/account-tokens";
import { resetPasswordEmail } from "@/lib/email-templates";
import { appUrl, sendMail } from "@/lib/mailer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isLoginRateLimited, recordFailedLogin } from "@/lib/supabase/login-rate-limit";
import { parseWith } from "@/lib/validation";

const forgotBody = z.object({ login: z.string().trim().min(1).max(254) });

/** The same answer whatever happened, so this can't be used to find out who has an account. */
const ANSWER = { message: "If that account has an email, a link to reset the password is on its way. Check your inbox and spam folder." };

/** Escapes ilike's wildcards, so a username matches only itself. */
const literal = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Emails a reset link to an Active account's confirmed email, found by
 * username or by that email. Limited per account through login_attempts
 * (a "reset:" key), so nobody can flood someone's inbox.
 */
export async function POST(request: Request) {
  const body = parseWith(forgotBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Enter your username or email." }, { status: 422 });
  const login = body.login.toLowerCase();

  const admin = createSupabaseAdminClient();
  let accountId: string | undefined;
  if (login.includes("@")) {
    const { data } = await admin.from("account_emails").select("account_id").eq("email", login).maybeSingle();
    accountId = data?.account_id;
  } else {
    const { data } = await admin.from("accounts").select("id").ilike("username", literal(login)).maybeSingle();
    accountId = data?.id;
  }
  if (!accountId) return NextResponse.json(ANSWER);

  const [{ data: account }, { data: email }] = await Promise.all([
    admin.from("accounts").select("username, status").eq("id", accountId).maybeSingle(),
    admin.from("account_emails").select("email").eq("account_id", accountId).maybeSingle(),
  ]);
  if (!account || account.status !== "Active" || !email?.email) return NextResponse.json(ANSWER);

  const limitKey = `reset:${accountId}`;
  if (await isLoginRateLimited(limitKey)) return NextResponse.json(ANSWER);
  await recordFailedLogin(limitKey);

  try {
    const token = await issueAccountToken(admin, accountId, "reset_password", email.email);
    const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
    await sendMail({ to: email.email, ...resetPasswordEmail(link, account.username) });
  } catch (caught) {
    console.error("[api/auth/forgot-password] reset email failed:", caught);
    return NextResponse.json({ message: "Could not send the email. Try again in a moment." }, { status: 502 });
  }
  return NextResponse.json(ANSWER);
}

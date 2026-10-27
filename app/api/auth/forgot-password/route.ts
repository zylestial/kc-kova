import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson } from "@/lib/api-route";
import { issueAccountToken } from "@/lib/account-tokens";
import { resetPasswordEmail } from "@/lib/email-templates";
import { appUrl, sendMail } from "@/lib/mailer";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { clientIp, FORGOT_IP_LIMIT, takeAttempts } from "@/lib/supabase/login-rate-limit";
import { parseWith } from "@/lib/validation";

// Email only (owner, 2026-10-22): text that isn't an email address is turned away.
const forgotBody = z.object({ login: z.string().trim().toLowerCase().pipe(z.email().max(254)) });

/** The same answer whatever happened, so this can't be used to find out who has an account. */
const ANSWER = { message: "If an account has that email, a link to reset the password is on its way. Check your inbox and spam folder." };

/**
 * Emails a reset link to the Active account whose confirmed email it is.
 * Limited per account through login_attempts (a "reset:" key), so nobody can flood someone's inbox,
 * and per network (a "forgot-ip:" key), so nobody can sweep every address.
 */
export async function POST(request: Request) {
  const body = parseWith(forgotBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Enter a valid email address." }, { status: 422 });

  const ip = clientIp(request);
  if (ip && !(await takeAttempts(`forgot-ip:${ip}`, FORGOT_IP_LIMIT)).ok) {
    return NextResponse.json({ message: "Too many requests. Try again in 15 minutes." }, { status: 429 });
  }

  const admin = createSupabaseAdminClient();
  const { data: found } = await admin.from("account_emails").select("account_id").eq("email", body.login).maybeSingle();
  const accountId = found?.account_id;
  if (!accountId) return NextResponse.json(ANSWER);

  const [{ data: account }, { data: email }] = await Promise.all([
    admin.from("accounts").select("username, status").eq("id", accountId).maybeSingle(),
    admin.from("account_emails").select("email").eq("account_id", accountId).maybeSingle(),
  ]);
  if (!account || account.status !== "Active" || !email?.email) return NextResponse.json(ANSWER);

  if (!(await takeAttempts(`reset:${accountId}`)).ok) return NextResponse.json(ANSWER);

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

import type { SupabaseClient } from "@supabase/supabase-js";
import { issueAccountToken } from "@/lib/account-tokens";
import { confirmEmail } from "@/lib/email-templates";
import { appUrl, sendMail } from "@/lib/mailer";
import { isLoginRateLimited, recordFailedLogin } from "@/lib/supabase/login-rate-limit";

/** An account's email (0072): `email` once confirmed; `pendingEmail` while its link waits to be opened. */
export type EmailStatus = { email: string | null; pendingEmail: string | null };

export async function emailStatus(admin: SupabaseClient, accountId: string): Promise<EmailStatus> {
  const { data } = await admin.from("account_emails").select("email, pending_email").eq("account_id", accountId).maybeSingle();
  return { email: data?.email ?? null, pendingEmail: data?.pending_email ?? null };
}

/**
 * Saves `email` as the account's pending email and sends it a confirm
 * link; the confirmed one, if any, keeps working until the link is
 * opened. Refused when another account already uses that email. Limited
 * per account through login_attempts (a "confirm:" key). `admin` is the
 * service-role client.
 */
export async function sendEmailConfirmation(
  admin: SupabaseClient,
  accountId: string,
  rawEmail: string,
): Promise<{ status: EmailStatus } | { code: number; message: string }> {
  const email = rawEmail.trim().toLowerCase();
  const { data: owner } = await admin.from("account_emails").select("account_id").eq("email", email).maybeSingle();
  if (owner && owner.account_id !== accountId) return { code: 409, message: "That email is already used by another KOVA account." };
  const current = await emailStatus(admin, accountId);
  if (current.email === email) return { code: 422, message: "That's already the confirmed email." };

  const limitKey = `confirm:${accountId}`;
  if (await isLoginRateLimited(limitKey)) return { code: 429, message: "Too many emails sent. Try again in 15 minutes." };
  await recordFailedLogin(limitKey);

  const { error } = await admin
    .from("account_emails")
    .upsert({ account_id: accountId, pending_email: email, updated_at: new Date().toISOString() });
  if (error) {
    console.error("[account-email] save failed:", error);
    return { code: 422, message: "Could not save the email." };
  }
  try {
    const { data: account } = await admin.from("accounts").select("username").eq("id", accountId).single();
    const token = await issueAccountToken(admin, accountId, "confirm_email", email);
    const link = appUrl(`/confirm-email?token=${encodeURIComponent(token)}`);
    await sendMail({ to: email, ...confirmEmail(link, { username: account?.username ?? "", email }) });
  } catch (caught) {
    console.error("[account-email] confirm email failed:", caught);
    return { code: 502, message: "Could not send the email. Try again in a moment." };
  }
  return { status: { email: current.email, pendingEmail: email } };
}

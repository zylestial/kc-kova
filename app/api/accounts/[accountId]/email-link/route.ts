import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { emailStatus, sendEmailConfirmation } from "@/lib/account-email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Sends an account's waiting email its confirm link again (Admin only). */
export const POST = authed<{ accountId: string }>(async ({ account, params: { accountId } }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  const { pendingEmail } = await emailStatus(admin, accountId);
  if (!pendingEmail) return NextResponse.json({ message: "This account has no email waiting to be confirmed." }, { status: 409 });
  const sent = await sendEmailConfirmation(admin, accountId, pendingEmail);
  if ("message" in sent) return NextResponse.json({ message: sent.message }, { status: sent.code });
  return new Response(null, { status: 204 });
});

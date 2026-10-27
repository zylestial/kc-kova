import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { emailStatus, sendEmailConfirmation } from "@/lib/account-email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PASSWORD_CHECK_MESSAGE, verifyCurrentPassword } from "@/lib/supabase/verify-password";
import { parseWith } from "@/lib/validation";

const emailBody = z.object({ email: z.email(), currentPassword: z.string().catch("") });

/** The signed-in account's email: confirmed, and any new one waiting for its link. */
export const GET = authed(async ({ account }) => {
  return NextResponse.json(await emailStatus(createSupabaseAdminClient(), account.id));
});

/**
 * Sets a new email for the signed-in account and emails it a confirm link.
 * Adding the first one (the step after sign-in) needs nothing more;
 * replacing a confirmed one needs the current password.
 */
export const POST = authed(async ({ request, account }) => {
  const body = parseWith(emailBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Enter a valid email address." }, { status: 422 });

  const admin = createSupabaseAdminClient();
  const { email: confirmed } = await emailStatus(admin, account.id);
  if (confirmed) {
    const check = await verifyCurrentPassword(account.username, body.currentPassword);
    if (check !== "ok") return NextResponse.json({ message: PASSWORD_CHECK_MESSAGE[check] }, { status: check === "locked" ? 429 : 403 });
  }
  const result = await sendEmailConfirmation(admin, account.id, body.email);
  if ("message" in result) return NextResponse.json({ message: result.message }, { status: result.code });
  return NextResponse.json(result.status);
});

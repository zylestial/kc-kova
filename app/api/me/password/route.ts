import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { passwordError } from "@/lib/password-policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { usernameToAuthEmail } from "@/lib/supabase/accounts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PASSWORD_CHECK_MESSAGE, verifyCurrentPassword } from "@/lib/supabase/verify-password";
import { parseWith } from "@/lib/validation";

const passwordChangeBody = z.object({ currentPassword: z.string().catch(""), newPassword: z.string().catch("") });

/** Changes the signed-in account's own password (My account), with the current one. */
export const POST = authed(async ({ request, account }) => {
  const body = parseWith(passwordChangeBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Enter your current and new password." }, { status: 422 });
  const problem = passwordError(body.newPassword, account.username);
  if (problem) return NextResponse.json({ message: problem }, { status: 422 });

  const check = await verifyCurrentPassword(account.username, body.currentPassword);
  if (check !== "ok") return NextResponse.json({ message: PASSWORD_CHECK_MESSAGE[check] }, { status: check === "locked" ? 429 : 403 });

  const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(account.id, { password: body.newPassword });
  if (error) {
    console.error("[api/me/password] update failed:", error);
    return NextResponse.json({ message: "Could not change the password." }, { status: 422 });
  }
  // Auth ends the account's sessions on a password change; start this one again.
  const supabase = await createSupabaseServerClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: usernameToAuthEmail(account.username),
    password: body.newPassword,
  });
  if (signInError) console.error("[api/me/password] sign-in after change failed:", signInError);
  return new Response(null, { status: 204 });
});

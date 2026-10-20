import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { passwordError } from "@/lib/password-policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { renameAuthUser, toAccount } from "@/lib/supabase/accounts";
import { PASSWORD_CHECK_MESSAGE, verifyCurrentPassword } from "@/lib/supabase/verify-password";
import { usernameError } from "@/lib/username-policy";
import { parseWith } from "@/lib/validation";

const usernameBody = z.object({ username: z.string().trim(), currentPassword: z.string().catch("") });

/**
 * Changes the signed-in account's own username (My account), with the
 * current password. Refused when the current password contains the new
 * username, so the password rule stays true. The session carries on.
 */
export const PUT = authed(async ({ request, account }) => {
  const body = parseWith(usernameBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Enter a new username." }, { status: 422 });
  const { username, currentPassword } = body;
  const problem = usernameError(username);
  if (problem) return NextResponse.json({ message: problem }, { status: 422 });
  if (username === account.username) return NextResponse.json({ message: "That's already your username." }, { status: 422 });

  const check = await verifyCurrentPassword(account.username, currentPassword);
  if (check !== "ok") return NextResponse.json({ message: PASSWORD_CHECK_MESSAGE[check] }, { status: check === "locked" ? 429 : 403 });
  if (passwordError(currentPassword, username)) {
    return NextResponse.json({ message: "Your password contains that username. Change your password first." }, { status: 422 });
  }

  const admin = createSupabaseAdminClient();
  if (username.toLowerCase() !== account.username.toLowerCase()) {
    const refused = await renameAuthUser(admin, account.id, username);
    if (refused) return NextResponse.json({ message: refused.message }, { status: refused.status });
  }
  const { data: row, error } = await admin.from("accounts").update({ username }).eq("id", account.id).select("*").single();
  if (error || !row) {
    // Put the Auth side back so sign-in still matches the old username.
    await renameAuthUser(admin, account.id, account.username);
    const isDuplicate = error?.code === "23505";
    return NextResponse.json({ message: isDuplicate ? "Username already exists." : "Could not change the username." }, { status: isDuplicate ? 409 : 422 });
  }
  return NextResponse.json(toAccount(row));
});

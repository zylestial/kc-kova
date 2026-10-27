import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { passwordError } from "@/lib/password-policy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { saveWithRename, toAccount } from "@/lib/supabase/accounts";
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
  // If the row is refused, the sign-in username is put back too.
  const saved = await saveWithRename(admin, account.id, account.username, username, () =>
    admin.from("accounts").update({ username }).eq("id", account.id).select("*").single(),
  );
  if ("refused" in saved) return NextResponse.json({ message: saved.refused.message }, { status: saved.refused.status });
  const { data: row, error } = saved.result;
  if (error || !row) {
    const isDuplicate = error?.code === "23505";
    return NextResponse.json({ message: isDuplicate ? "Username already exists." : "Could not change the username." }, { status: isDuplicate ? 409 : 422 });
  }
  return NextResponse.json(toAccount(row));
});

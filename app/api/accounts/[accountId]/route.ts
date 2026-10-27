import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { emailStatus, sendEmailConfirmation } from "@/lib/account-email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requestAccessError, saveWithRename, toAccount } from "@/lib/supabase/accounts";
import { updateAccountBody } from "@/lib/admin-input";
import { usernameError } from "@/lib/username-policy";
import { parseWith } from "@/lib/validation";

export const PUT = authed<{ accountId: string }>(async ({ request, account, params: { accountId } }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = parseWith(updateAccountBody, await readJson(request));
  if (!body) {
    return NextResponse.json({ message: "Name, username, role, and status are required." }, { status: 422 });
  }
  const { name, username, role, status, email, position, driverType, canRequestDaily, canRequestCompany, canDriveCompany } = body;
  if (email && !z.email().safeParse(email).success) {
    return NextResponse.json({ message: "Enter a valid email address." }, { status: 422 });
  }

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.from("accounts").select("*").eq("id", accountId).maybeSingle();
  if (!existing) return NextResponse.json({ message: "Account not found." }, { status: 404 });
  // An Admin can't take away their own access, so there's always an Admin left to manage accounts.
  if (accountId === account.id && (role !== existing.role || status !== existing.status)) {
    return NextResponse.json({ message: "You can't change your own account type or status. Ask another Admin." }, { status: 422 });
  }

  // A new username follows the same rule as one people choose themselves;
  // an older one that doesn't is left alone when only other fields change.
  if (username !== existing.username) {
    const problem = usernameError(username);
    if (problem) return NextResponse.json({ message: problem }, { status: 422 });
  }

  // If the row is refused, the sign-in username is put back too.
  const saved = await saveWithRename(admin, accountId, existing.username, username, () =>
    admin
      .from("accounts")
      .update({
        name,
        username,
        role,
        status,
        position,
        driver_type: driverType,
        can_request_daily: canRequestDaily,
        can_request_company: canRequestCompany,
        can_drive_company: canDriveCompany,
      })
      .eq("id", accountId)
      .select("*")
      .single(),
  );
  if ("refused" in saved) return NextResponse.json({ message: saved.refused.message }, { status: saved.refused.status });
  const { data: accountRow, error: updateError } = saved.result;
  if (updateError || !accountRow) {
    const isDuplicate = updateError?.code === "23505";
    const message = isDuplicate ? "Username already exists." : (requestAccessError(updateError) ?? "Could not update the account.");
    return NextResponse.json({ message }, { status: isDuplicate ? 409 : 422 });
  }

  // A new email waits for its link (0072); the confirmed one keeps working until then.
  if (email) {
    const current = await emailStatus(admin, accountId);
    if (email !== current.email && email !== current.pendingEmail) {
      const sent = await sendEmailConfirmation(admin, accountId, email);
      if ("message" in sent) return NextResponse.json({ message: `Saved, but the email wasn't changed: ${sent.message}` }, { status: sent.code });
    }
  }

  return NextResponse.json(toAccount(accountRow));
});

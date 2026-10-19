import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { emailStatus, sendEmailConfirmation } from "@/lib/account-email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { renameAuthUser, requestAccessError, toAccount } from "@/lib/supabase/accounts";
import { updateAccountBody } from "@/lib/admin-input";
import { parseWith } from "@/lib/validation";

export const PUT = authed<{ accountId: string }>(async ({ request, account, params: { accountId } }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = parseWith(updateAccountBody, await readJson(request));
  if (!body) {
    return NextResponse.json({ message: "Name, username, role, and status are required." }, { status: 422 });
  }
  const { name, username, role, status, email, position, driverType, canRequestDaily, canRequestCompany } = body;
  if (email && !z.email().safeParse(email).success) {
    return NextResponse.json({ message: "Enter a valid email address." }, { status: 422 });
  }

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.from("accounts").select("*").eq("id", accountId).maybeSingle();
  if (!existing) return NextResponse.json({ message: "Account not found." }, { status: 404 });

  if (username.toLowerCase() !== existing.username.toLowerCase()) {
    const refused = await renameAuthUser(admin, accountId, username);
    if (refused) return NextResponse.json({ message: refused.message }, { status: refused.status });
  }

  const { data: accountRow, error: updateError } = await admin
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
    })
    .eq("id", accountId)
    .select("*")
    .single();
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

import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toAccount, usernameToAuthEmail } from "@/lib/supabase/accounts";
import { updateAccountBody } from "@/lib/admin-input";
import { parseWith } from "@/lib/validation";

export const PUT = authed<{ accountId: string }>(async ({ request, account, params: { accountId } }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = parseWith(updateAccountBody, await readJson(request));
  if (!body) {
    return NextResponse.json({ message: "Name, username, role, and status are required." }, { status: 422 });
  }
  const { name, username, role, status } = body;

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.from("accounts").select("*").eq("id", accountId).maybeSingle();
  if (!existing) return NextResponse.json({ message: "Account not found." }, { status: 404 });

  if (username.toLowerCase() !== existing.username.toLowerCase()) {
    const { error: emailError } = await admin.auth.admin.updateUserById(accountId, { email: usernameToAuthEmail(username) });
    if (emailError) {
      const isDuplicate = emailError.code === "email_exists" || /already been registered/i.test(emailError.message ?? "");
      return NextResponse.json({ message: isDuplicate ? "Username already exists." : "Could not update the account." }, { status: isDuplicate ? 409 : 422 });
    }
  }

  const { data: accountRow, error: updateError } = await admin
    .from("accounts")
    .update({ name, username, role, status })
    .eq("id", accountId)
    .select("*")
    .single();
  if (updateError || !accountRow) {
    const isDuplicate = updateError?.code === "23505";
    return NextResponse.json({ message: isDuplicate ? "Username already exists." : "Could not update the account." }, { status: isDuplicate ? 409 : 422 });
  }

  return NextResponse.json(toAccount(accountRow));
});

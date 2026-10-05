import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toAccount, usernameToAuthEmail } from "@/lib/supabase/accounts";
import { passwordError } from "@/lib/password-policy";
import { createAccountBody } from "@/lib/admin-input";
import { parseWith } from "@/lib/validation";

export const POST = authed(async ({ request, account }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = parseWith(createAccountBody, await readJson(request));
  if (!body) {
    return NextResponse.json({ message: "Name, username, role, and a password are required." }, { status: 422 });
  }
  const { name, username, role, status, password } = body;
  const passwordProblem = passwordError(password, username);
  if (passwordProblem) return NextResponse.json({ message: passwordProblem }, { status: 422 });

  const admin = createSupabaseAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: usernameToAuthEmail(username),
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    console.error("[api/accounts] createUser failed:", createError);
    const isDuplicate = createError?.code === "email_exists" || /already been registered/i.test(createError?.message ?? "");
    return NextResponse.json({ message: isDuplicate ? "Username already exists." : "Could not create the account." }, { status: isDuplicate ? 409 : 422 });
  }

  const { data: accountRow, error: insertError } = await admin
    .from("accounts")
    .insert({ id: created.user.id, username, name, role, status })
    .select("*")
    .single();
  if (insertError || !accountRow) {
    console.error("[api/accounts] accounts insert failed:", insertError);
    await admin.auth.admin.deleteUser(created.user.id);
    const isDuplicate = insertError?.code === "23505";
    return NextResponse.json({ message: isDuplicate ? "Username already exists." : "Could not create the account." }, { status: isDuplicate ? 409 : 422 });
  }

  return NextResponse.json(toAccount(accountRow), { status: 201 });
});

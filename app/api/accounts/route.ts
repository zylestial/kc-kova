import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { sendEmailConfirmation } from "@/lib/account-email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createAccount } from "@/lib/supabase/accounts";
import { passwordError } from "@/lib/password-policy";
import { createAccountBody } from "@/lib/admin-input";
import { parseWith } from "@/lib/validation";

export const POST = authed(async ({ request, account }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = parseWith(createAccountBody, await readJson(request));
  if (!body) {
    return NextResponse.json({ message: "Name, username, role, and a password are required." }, { status: 422 });
  }
  // Every account has an email (0072); it's confirmed by the link sent to it.
  if (!z.email().safeParse(body.email).success) {
    return NextResponse.json({ message: "Enter a valid email address." }, { status: 422 });
  }
  const passwordProblem = passwordError(body.password, body.username);
  if (passwordProblem) return NextResponse.json({ message: passwordProblem }, { status: 422 });

  const admin = createSupabaseAdminClient();
  const { data: taken } = await admin.from("account_emails").select("account_id").eq("email", body.email).maybeSingle();
  if (taken) return NextResponse.json({ message: "That email is already used by another KOVA account." }, { status: 409 });

  const result = await createAccount(admin, { ...body, driverType: body.driverType ?? null });
  if ("message" in result) return NextResponse.json({ message: result.message }, { status: result.status });
  // The account stands even if the email can't go out now; Resend is on the list.
  const sent = await sendEmailConfirmation(admin, result.account.id, body.email);
  if ("message" in sent) console.error("[api/accounts] confirm email not sent:", sent.message);
  return NextResponse.json(result.account, { status: 201 });
});

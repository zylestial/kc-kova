import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
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
  const passwordProblem = passwordError(body.password, body.username);
  if (passwordProblem) return NextResponse.json({ message: passwordProblem }, { status: 422 });

  const result = await createAccount(createSupabaseAdminClient(), { ...body, driverType: body.driverType ?? null });
  if ("message" in result) return NextResponse.json({ message: result.message }, { status: result.status });
  return NextResponse.json(result.account, { status: 201 });
});

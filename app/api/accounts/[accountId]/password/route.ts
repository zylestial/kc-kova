import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { passwordError } from "@/lib/password-policy";

export const POST = authed<{ accountId: string }>(async ({ request, account, params: { accountId } }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const admin = createSupabaseAdminClient();
  const { data: target } = await admin.from("accounts").select("username").eq("id", accountId).maybeSingle();
  if (!target) return NextResponse.json({ message: "Account not found." }, { status: 404 });
  const problem = passwordError(password, target.username);
  if (problem) return NextResponse.json({ message: problem }, { status: 422 });

  const { error } = await admin.auth.admin.updateUserById(accountId, { password });
  if (error) return NextResponse.json({ message: "Could not update the password." }, { status: 422 });

  return new Response(null, { status: 204 });
});

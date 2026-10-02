import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const POST = authed<{ accountId: string }>(async ({ request, account, params: { accountId } }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 8) {
    return NextResponse.json({ message: "Password must be at least 8 characters." }, { status: 422 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(accountId, { password });
  if (error) return NextResponse.json({ message: "Could not update the password." }, { status: 422 });

  return new Response(null, { status: 204 });
});

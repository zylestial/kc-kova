import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toAccount, usernameToAuthEmail } from "@/lib/supabase/accounts";
import { requireAccount } from "@/lib/supabase/session";

const ROLES = ["Booker", "Driver", "Admin"] as const;
const STATUSES = ["Active", "Inactive"] as const;

export async function PUT(request: Request, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const role = body?.role;
  const status = body?.status;
  const project = typeof body?.project === "string" ? body.project : null;
  if (!name || !username || !ROLES.includes(role) || !STATUSES.includes(status)) {
    return NextResponse.json({ message: "Name, username, role, and status are required." }, { status: 422 });
  }

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
    .update({ name, username, role, status, project })
    .eq("id", accountId)
    .select("*")
    .single();
  if (updateError || !accountRow) {
    const isDuplicate = updateError?.code === "23505";
    return NextResponse.json({ message: isDuplicate ? "Username already exists." : "Could not update the account." }, { status: isDuplicate ? 409 : 422 });
  }

  return NextResponse.json(toAccount(accountRow));
}

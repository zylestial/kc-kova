import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toAccount, usernameToAuthEmail } from "@/lib/supabase/accounts";
import { requireAccount } from "@/lib/supabase/session";

const ROLES = ["Requester", "Scheduler", "Admin", "Driver"] as const;
const STATUSES = ["Active", "Inactive"] as const;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const role = body?.role;
  const status = STATUSES.includes(body?.status) ? body.status : "Active";
  const project = typeof body?.project === "string" ? body.project : null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!name || !username || !ROLES.includes(role) || password.length < 8) {
    return NextResponse.json({ message: "Name, username, role, and an 8+ character password are required." }, { status: 422 });
  }

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
    .insert({ id: created.user.id, username, name, role, status, project })
    .select("*")
    .single();
  if (insertError || !accountRow) {
    console.error("[api/accounts] accounts insert failed:", insertError);
    await admin.auth.admin.deleteUser(created.user.id);
    const isDuplicate = insertError?.code === "23505";
    return NextResponse.json({ message: isDuplicate ? "Username already exists." : "Could not create the account." }, { status: isDuplicate ? 409 : 422 });
  }

  return NextResponse.json(toAccount(accountRow), { status: 201 });
}

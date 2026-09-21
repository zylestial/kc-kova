import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { toPerson } from "@/lib/supabase/mappers";

const STATUSES = ["Active", "Inactive"] as const;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const status = STATUSES.includes(body?.status) ? body.status : "Active";
  const projectIds = Array.isArray(body?.projectIds) ? body.projectIds.filter((v: unknown) => typeof v === "string") : [];
  const accountId = typeof body?.accountId === "string" ? body.accountId : null;
  if (!name) return NextResponse.json({ message: "Name is required." }, { status: 422 });

  // people_admin_write RLS policy enforces the Admin check server-side too.
  const { data, error } = await supabase
    .from("people")
    .upsert({ id, name, project_ids: projectIds, status, account_id: accountId })
    .select("*")
    .single();
  if (error || !data) return NextResponse.json({ message: "Could not save the person." }, { status: 422 });

  return NextResponse.json(toPerson(data));
}

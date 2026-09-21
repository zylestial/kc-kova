import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";

const STATUSES = ["Active", "Inactive"] as const;

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const plate = typeof body?.plate === "string" ? body.plate.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const status = STATUSES.includes(body?.status) ? body.status : "Active";
  if (!plate || !name) {
    return NextResponse.json({ message: "Plate and name are required." }, { status: 422 });
  }

  // vehicles_admin_write RLS policy enforces the Admin check server-side too.
  const { data, error } = await supabase.from("vehicles").insert({ plate, name, status }).select("*").single();
  if (error || !data) {
    const isDuplicate = error?.code === "23505";
    return NextResponse.json({ message: isDuplicate ? "Plate already in use." : "Could not create the vehicle." }, { status: isDuplicate ? 409 : 422 });
  }

  return NextResponse.json(data, { status: 201 });
}

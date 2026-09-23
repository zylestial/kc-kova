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
  const assignedDriverId = typeof body?.assignedDriverId === "string" && body.assignedDriverId ? body.assignedDriverId : null;
  if (!plate || !name) {
    return NextResponse.json({ message: "Plate and name are required." }, { status: 422 });
  }

  // vehicles_admin_write RLS policy enforces the Admin check server-side too;
  // the assigned_driver_id triggers enforce it must be an active Driver and
  // not already assigned elsewhere.
  const { data, error } = await supabase
    .from("vehicles")
    .insert({ plate, name, status, assigned_driver_id: assignedDriverId })
    .select("*")
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      const message = error.message.includes("vehicles_pkey")
        ? "Plate already in use."
        : "That Driver is already assigned to another vehicle.";
      return NextResponse.json({ message }, { status: 409 });
    }
    return NextResponse.json({ message: error?.message || "Could not create the vehicle." }, { status: 422 });
  }

  return NextResponse.json(data, { status: 201 });
}

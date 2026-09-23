import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";

const STATUSES = ["Active", "Inactive"] as const;

export async function PUT(request: Request, { params }: { params: Promise<{ plate: string }> }) {
  const { plate: originalPlate } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const plate = typeof body?.plate === "string" ? body.plate.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const status = body?.status;
  const assignedDriverId = typeof body?.assignedDriverId === "string" && body.assignedDriverId ? body.assignedDriverId : null;
  if (!plate || !name || !STATUSES.includes(status)) {
    return NextResponse.json({ message: "Plate, name, and status are required." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("rename_vehicle", {
    p_old_plate: decodeURIComponent(originalPlate),
    p_new_plate: plate,
    p_name: name,
    p_status: status,
    p_assigned_driver_id: assignedDriverId,
  });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ message: "Plate already in use." }, { status: 409 });
    if (error.message.includes("already assigned to another vehicle")) {
      return NextResponse.json({ message: "That Driver is already assigned to another vehicle." }, { status: 409 });
    }
    if (error.code === "P0002") return NextResponse.json({ message: "Vehicle not found." }, { status: 404 });
    if (error.code === "42501") return NextResponse.json({ message: "Admin access required." }, { status: 403 });
    return NextResponse.json({ message: error.message || "Could not update the vehicle." }, { status: 422 });
  }

  return NextResponse.json(data);
}

import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { toVehicle } from "@/lib/supabase/mappers";
import { updateVehicleBody } from "@/lib/admin-input";
import { parseWith } from "@/lib/validation";

export const PUT = authed<{ plate: string }>(async ({ request, supabase, account, params: { plate: originalPlate } }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = parseWith(updateVehicleBody, await readJson(request));
  if (!body) {
    return NextResponse.json({ message: "Plate, name, and status are required." }, { status: 422 });
  }
  const { plate, name, status, assignedDriverId, type, requestable } = body;

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

  // rename_vehicle doesn't know the type or the request toggle (0051), and
  // a new plate starts with the column defaults, so set both afterwards.
  // The vehicles_admin_update RLS policy keeps this Admin-only.
  const { data: updated, error: updateError } = await supabase
    .from("vehicles")
    .update({ vehicle_type: type, requestable })
    .eq("plate", data.plate)
    .select("*")
    .single();
  if (updateError || !updated) {
    return NextResponse.json({ message: updateError?.message || "Could not update the vehicle." }, { status: 422 });
  }

  return NextResponse.json(toVehicle(updated));
});

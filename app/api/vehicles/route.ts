import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { toVehicle } from "@/lib/supabase/mappers";
import { createVehicleBody } from "@/lib/admin-input";
import { parseWith } from "@/lib/validation";

export const POST = authed(async ({ request, supabase, account }) => {
  if (account.role !== "Admin") return NextResponse.json({ message: "Admin access required." }, { status: 403 });

  const body = parseWith(createVehicleBody, await readJson(request));
  if (!body) {
    return NextResponse.json({ message: "Plate and name are required." }, { status: 422 });
  }
  const { plate, name, status, assignedDriverId, companyTrips, hasOdometer } = body;

  // vehicles_admin_write RLS policy enforces the Admin check server-side too;
  // the assigned_driver_id triggers enforce it must be an active Driver and
  // not already assigned elsewhere.
  const { data, error } = await supabase
    .from("vehicles")
    .insert({ plate, name, status, assigned_driver_id: assignedDriverId, company_trips: companyTrips, has_odometer: hasOdometer })
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

  return NextResponse.json(toVehicle(data), { status: 201 });
});

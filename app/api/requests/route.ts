import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { toTransportRequest } from "@/lib/supabase/mappers";
import { parseRequestInput } from "@/lib/request-input";
import { requestDateError, requestTypeFor } from "@/lib/timezone";

function errorResponse(error: { code?: string; message: string }) {
  if (error.code === "42501") return NextResponse.json({ message: "Not authorized to create requests." }, { status: 403 });
  return NextResponse.json({ message: error.message || "Could not create the request." }, { status: 422 });
}

export const POST = authed(async ({ request, supabase, account }) => {
  const input = parseRequestInput(await readJson(request));
  if (!input) {
    return NextResponse.json({ message: "Date and at least one destination with a purpose are required." }, { status: 422 });
  }
  const dateError = requestDateError(input.date, account.role === "Admin");
  if (dateError) return NextResponse.json({ message: dateError }, { status: 422 });

  // Requested By is always the signed-in account; create_request takes it
  // from auth.uid(), never from the body. The type comes from the date.
  const { data, error } = await supabase.rpc("create_request", {
    p_requested_date: input.date,
    p_request_type: requestTypeFor(input.date),
    p_project_id: input.projectId,
    p_project_other: input.projectOther,
    p_destinations: input.destinations,
    p_vehicle_plate: input.vehiclePlate || null,
  });
  if (error || !data) return errorResponse(error ?? { message: "Could not create the request." });

  const { data: row } = await supabase
    .from("requests")
    .select("*, request_destinations(*)")
    .eq("id", data.id)
    .eq("request_destinations.active", true)
    .single();
  return NextResponse.json(toTransportRequest(row ?? data), { status: 201 });
});

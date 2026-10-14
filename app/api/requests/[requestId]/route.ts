import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { toTransportRequest } from "@/lib/supabase/mappers";
import { parseRequestInput } from "@/lib/request-input";
import { parseWith, rowVersionBody } from "@/lib/validation";
import { requestDateError, requestTypeFor } from "@/lib/timezone";

function errorResponse(error: { code?: string; message: string }) {
  if (error.code === "42501") return NextResponse.json({ message: "Not authorized to edit this request." }, { status: 403 });
  if (error.code === "P0002") return NextResponse.json({ message: "Request not found." }, { status: 404 });
  if (error.code === "PT409") return NextResponse.json({ message: error.message }, { status: 409 });
  return NextResponse.json({ message: error.message || "Could not update the request." }, { status: 422 });
}

export const PUT = authed<{ requestId: string }>(async ({ request, supabase, account, params: { requestId } }) => {
  const body = await readJson(request);
  const input = parseRequestInput(body);
  const version = parseWith(rowVersionBody, body);
  if (!input || !version) {
    return NextResponse.json({ message: "Date, vehicle and at least one destination with a purpose are required." }, { status: 422 });
  }

  // The type is set from the date when it was asked for; it only changes
  // when the date does, so editing a Regular request's stops near its day
  // doesn't turn it Urgent.
  const { data: existing } = await supabase
    .from("requests")
    .select("requested_date, request_type")
    .eq("id", requestId)
    .maybeSingle();
  const dateChanged = existing?.requested_date !== input.date;
  if (dateChanged) {
    const dateError = requestDateError(input.date, account.role === "Admin");
    if (dateError) return NextResponse.json({ message: dateError }, { status: 422 });
  }

  // rowVersion is the version the form was opened on; update_request
  // refuses the save if the request changed since, or was scheduled.
  const { data, error } = await supabase.rpc("update_request", {
    p_request_id: requestId,
    p_expected_row_version: version.rowVersion,
    p_requested_date: input.date,
    p_request_type: dateChanged || !existing ? requestTypeFor(input.date) : existing.request_type,
    p_project_id: input.projectId,
    p_project_other: input.projectOther,
    p_destinations: input.destinations,
    p_vehicle_plate: input.vehiclePlate,
  });
  if (error || !data) return errorResponse(error ?? { message: "Could not update the request." });

  const { data: row } = await supabase
    .from("requests")
    .select("*, request_destinations(*)")
    .eq("id", requestId)
    .eq("request_destinations.active", true)
    .single();
  return NextResponse.json(toTransportRequest(row ?? data));
});

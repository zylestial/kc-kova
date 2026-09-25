import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { toTransportRequest } from "@/lib/supabase/mappers";
import { parseRequestInput } from "@/lib/request-input";

function errorResponse(error: { code?: string; message: string }) {
  if (error.code === "42501") return NextResponse.json({ message: "Not authorized to edit this request." }, { status: 403 });
  if (error.code === "P0002") return NextResponse.json({ message: "Request not found." }, { status: 404 });
  if (error.code === "PT409") return NextResponse.json({ message: error.message }, { status: 409 });
  return NextResponse.json({ message: error.message || "Could not update the request." }, { status: 422 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const input = parseRequestInput(body);
  const rowVersion = Number(body?.rowVersion);
  if (!input || !Number.isInteger(rowVersion)) {
    return NextResponse.json({ message: "Date, request type, and at least one destination with a purpose are required." }, { status: 422 });
  }

  // rowVersion is the version the form was opened on; update_request
  // refuses the save if the request changed since, or was scheduled.
  const { data, error } = await supabase.rpc("update_request", {
    p_request_id: requestId,
    p_expected_row_version: rowVersion,
    p_requested_date: input.date,
    p_request_type: input.requestType,
    p_project_id: input.projectId,
    p_project_other: input.projectOther,
    p_destinations: input.destinations,
  });
  if (error || !data) return errorResponse(error ?? { message: "Could not update the request." });

  const { data: row } = await supabase
    .from("requests")
    .select("*, request_destinations(*)")
    .eq("id", requestId)
    .eq("request_destinations.active", true)
    .single();
  return NextResponse.json(toTransportRequest(row ?? data));
}

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { toTransportRequest } from "@/lib/supabase/mappers";
import { parseRequestInput } from "@/lib/request-input";

function errorResponse(error: { code?: string; message: string }) {
  if (error.code === "42501") return NextResponse.json({ message: "Not authorized to create requests." }, { status: 403 });
  return NextResponse.json({ message: error.message || "Could not create the request." }, { status: 422 });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const input = parseRequestInput(await request.json().catch(() => null));
  if (!input) {
    return NextResponse.json({ message: "Date, request type, and at least one destination with a purpose are required." }, { status: 422 });
  }

  // Requested By is always the signed-in account; create_request takes it
  // from auth.uid(), never from the body.
  const { data, error } = await supabase.rpc("create_request", {
    p_requested_date: input.date,
    p_request_type: input.requestType,
    p_project_id: input.projectId,
    p_project_other: input.projectOther,
    p_destinations: input.destinations,
  });
  if (error || !data) return errorResponse(error ?? { message: "Could not create the request." });

  const { data: row } = await supabase
    .from("requests")
    .select("*, request_destinations(*)")
    .eq("id", data.id)
    .eq("request_destinations.active", true)
    .single();
  return NextResponse.json(toTransportRequest(row ?? data), { status: 201 });
}

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/session";
import { toTransportRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";

// A Scheduler (or Admin, as Scheduler) moves stops a vehicle can't fit into a
// new request for the same requester and day. Returns the new request.
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const supabase = await createSupabaseServerClient();
  const account = await requireAccount(supabase);
  if (!account) return NextResponse.json({ message: "Sign in required." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const destinationIds: unknown = body?.destinationIds;
  if (!Array.isArray(destinationIds) || !destinationIds.length || !destinationIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ message: "Choose at least one stop to split off." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("split_request", { p_request_id: requestId, p_destination_ids: destinationIds });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not split the request." }, "Could not split the request.");

  const { data: row } = await supabase
    .from("requests")
    .select("*, request_destinations(*)")
    .eq("id", data.id)
    .eq("request_destinations.active", true)
    .single();
  return NextResponse.json(toTransportRequest(row ?? data), { status: 201 });
}

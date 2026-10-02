import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { toTransportRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";

// A Scheduler (or Admin, as Scheduler) sends unplaced requests back to their
// requesters, all or nothing, so they can move them to another day. The
// reason is optional.
export const POST = authed(async ({ request, supabase }) => {
  const body = await request.json().catch(() => null);
  const requestIds: unknown = body?.requestIds;
  if (!Array.isArray(requestIds) || !requestIds.length || requestIds.length > 100 || !requestIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ message: "Choose at least one request to send back." }, { status: 422 });
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  const { error } = await supabase.rpc("send_back_requests", { p_request_ids: requestIds, p_reason: reason });
  if (error) return cancellationErrorResponse(error, "Could not send the requests back.");

  const { data: rows } = await supabase
    .from("requests")
    .select("*, request_destinations(*)")
    .in("id", requestIds)
    .eq("request_destinations.active", true);
  return NextResponse.json((rows ?? []).map((row) => toTransportRequest(row)));
});

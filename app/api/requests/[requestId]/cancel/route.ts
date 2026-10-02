import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { toTransportRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";

// The owner cancels a request no schedule holds. A request already in a
// schedule goes through ./cancellation instead.
export const POST = authed<{ requestId: string }>(async ({ supabase, params: { requestId } }) => {
  const { data, error } = await supabase.rpc("cancel_request", { p_request_id: requestId });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not cancel the request." }, "Could not cancel the request.");

  const { data: row } = await supabase
    .from("requests")
    .select("*, request_destinations(*)")
    .eq("id", requestId)
    .eq("request_destinations.active", true)
    .single();
  return NextResponse.json(toTransportRequest(row ?? data));
});

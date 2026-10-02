import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { toCancellationRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";

// The owner asks an Admin to cancel a request that is in a schedule. The
// schedule stays in force until the Admin confirms.
export const POST = authed<{ requestId: string }>(async ({ request, supabase, params: { requestId } }) => {
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  const { data, error } = await supabase.rpc("request_cancellation", { p_request_id: requestId, p_reason: reason });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not request the cancellation." }, "Could not request the cancellation.");
  return NextResponse.json(toCancellationRequest(data));
});

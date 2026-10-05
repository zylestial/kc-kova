import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { toCancellationRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";
import { trimmedText } from "@/lib/validation";

// The reason is optional; a missing body counts as no reason.
const cancellationBody = z.object({ reason: trimmedText }).catch({ reason: "" });

// The owner asks an Admin to cancel a request that is in a schedule. The
// schedule stays in force until the Admin confirms.
export const POST = authed<{ requestId: string }>(async ({ request, supabase, params: { requestId } }) => {
  const { reason } = cancellationBody.parse(await readJson(request));

  const { data, error } = await supabase.rpc("request_cancellation", { p_request_id: requestId, p_reason: reason });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not request the cancellation." }, "Could not request the cancellation.");
  return NextResponse.json(toCancellationRequest(data));
});

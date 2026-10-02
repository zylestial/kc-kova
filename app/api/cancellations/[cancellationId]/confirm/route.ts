import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { toCancellationRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";

// Admin confirms: cancels only that request. The schedule then needs a new
// version without it, unless nothing else was left in it.
export const POST = authed<{ cancellationId: string }>(async ({ supabase, params: { cancellationId } }) => {
  const { data, error } = await supabase.rpc("confirm_cancellation", { p_cancellation_id: cancellationId });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not confirm the cancellation." }, "Could not confirm the cancellation.");
  return NextResponse.json(toCancellationRequest(data));
});

import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { REQUEST_SELECT, toTransportRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";
import { parseWith, trimmedText } from "@/lib/validation";

const sendBackBody = z.object({
  requestIds: z.array(z.string()).min(1).max(100),
  reason: trimmedText,
});

// A Scheduler (or Admin, as Scheduler) sends unplaced requests back to their
// requesters, all or nothing, so they can move them to another day. The
// reason is optional.
export const POST = authed(async ({ request, supabase }) => {
  const body = parseWith(sendBackBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Choose at least one request to send back." }, { status: 422 });
  const { requestIds, reason } = body;

  const { error } = await supabase.rpc("send_back_requests", { p_request_ids: requestIds, p_reason: reason });
  if (error) return cancellationErrorResponse(error, "Could not send the requests back.");

  const { data: rows } = await supabase
    .from("requests")
    .select(REQUEST_SELECT)
    .in("id", requestIds)
    .eq("request_destinations.active", true);
  return NextResponse.json((rows ?? []).map((row) => toTransportRequest(row)));
});

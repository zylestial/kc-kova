import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { REQUEST_SELECT, toTransportRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";
import { isoDate, parseWith } from "@/lib/validation";

const moveBody = z.object({ date: isoDate });

// A Scheduler (or Admin, as Scheduler) moves an "any day that week" stop to
// another day of its week; move_request_day (0053) checks the rest and tells
// the requester. Returns the stop.
export const POST = authed<{ requestId: string }>(async ({ request, supabase, params: { requestId } }) => {
  const body = parseWith(moveBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Pick a day." }, { status: 422 });

  const { data, error } = await supabase.rpc("move_request_day", { p_request_id: requestId, p_date: body.date });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not move the stop." }, "Could not move the stop.");

  const { data: row } = await supabase
    .from("requests")
    .select(REQUEST_SELECT)
    .eq("id", requestId)
    .eq("request_destinations.active", true)
    .single();
  return NextResponse.json(toTransportRequest(row ?? data));
});

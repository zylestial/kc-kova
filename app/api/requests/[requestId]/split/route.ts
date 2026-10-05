import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { toTransportRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";
import { parseWith } from "@/lib/validation";

const splitBody = z.object({ destinationIds: z.array(z.string()).min(1) });

// A Scheduler (or Admin, as Scheduler) moves stops a vehicle can't fit into a
// new request for the same requester and day. Returns the new request.
export const POST = authed<{ requestId: string }>(async ({ request, supabase, params: { requestId } }) => {
  const body = parseWith(splitBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Choose at least one stop to split off." }, { status: 422 });

  const { data, error } = await supabase.rpc("split_request", { p_request_id: requestId, p_destination_ids: body.destinationIds });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not split the request." }, "Could not split the request.");

  const { data: row } = await supabase
    .from("requests")
    .select("*, request_destinations(*)")
    .eq("id", data.id)
    .eq("request_destinations.active", true)
    .single();
  return NextResponse.json(toTransportRequest(row ?? data), { status: 201 });
});

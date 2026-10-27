import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";
import { isoDate, parseWith } from "@/lib/validation";

const newDayBody = z.object({ date: isoDate });

// The requester moves their sent-back stop to another day while the rest of
// its request is being scheduled; move_sent_back_stop (0081) makes it a
// request of its own on that day and puts it back in the pool.
export const POST = authed<{ requestId: string }>(async ({ request, supabase, params: { requestId } }) => {
  const body = parseWith(newDayBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Pick a day." }, { status: 422 });

  const { data, error } = await supabase.rpc("move_sent_back_stop", { p_request_id: requestId, p_date: body.date });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not move the stop." }, "Could not move the stop.");
  return new Response(null, { status: 204 });
});

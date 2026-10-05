import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { toCancellationRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";
import { parseWith } from "@/lib/validation";

const declineBody = z.object({ note: z.string().trim().min(1) });

// Admin declines: the request and its schedule stay as they were. A note
// telling the Requester why is required.
export const POST = authed<{ cancellationId: string }>(async ({ request, supabase, params: { cancellationId } }) => {
  const body = parseWith(declineBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Add a note explaining why the request stays." }, { status: 422 });

  const { data, error } = await supabase.rpc("decline_cancellation", { p_cancellation_id: cancellationId, p_note: body.note });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not decline the cancellation." }, "Could not decline the cancellation.");
  return NextResponse.json(toCancellationRequest(data));
});

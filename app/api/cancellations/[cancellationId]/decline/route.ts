import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { toCancellationRequest } from "@/lib/supabase/mappers";
import { cancellationErrorResponse } from "@/lib/supabase/cancellations";

// Admin declines: the request and its schedule stay as they were. A note
// telling the Requester why is required.
export const POST = authed<{ cancellationId: string }>(async ({ request, supabase, params: { cancellationId } }) => {
  const body = await request.json().catch(() => null);
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!note) return NextResponse.json({ message: "Add a note explaining why the request stays." }, { status: 422 });

  const { data, error } = await supabase.rpc("decline_cancellation", { p_cancellation_id: cancellationId, p_note: note });
  if (error || !data) return cancellationErrorResponse(error ?? { message: "Could not decline the cancellation." }, "Could not decline the cancellation.");
  return NextResponse.json(toCancellationRequest(data));
});

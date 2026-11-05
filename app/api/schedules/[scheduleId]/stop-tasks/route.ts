import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseStopTaskInput, tapRpc } from "@/lib/attendance-input";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// The Driver marks one request at a stop Done, or takes that back with Undo
// (0088). Who may, and when, is enforced in Postgres. A repeat is fine.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const input = parseStopTaskInput(await readJson(request));
  if (!input) {
    return NextResponse.json({ message: "That tap couldn't be read. Try again." }, { status: 422 });
  }

  const args = { p_schedule_id: scheduleId, p_leg_id: input.legId, p_request_id: input.requestId };
  const { error } =
    input.kind === "UNDO"
      ? await supabase.rpc("undo_stop_task", args)
      : await supabase.rpc(...tapRpc("record_stop_task", args, input.tappedAt));
  if (error) {
    return scheduleErrorResponse(error, "Could not save that task.");
  }

  return NextResponse.json({ ok: true });
});

import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";

// Admin sends the submitted version back to the Scheduler. A comment
// saying what needs to change is required.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const body = await request.json().catch(() => null);
  const rowVersion = Number(body?.rowVersion);
  if (!Number.isInteger(rowVersion)) return NextResponse.json({ message: "rowVersion is required." }, { status: 422 });
  const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
  if (!comment) return NextResponse.json({ message: "Add a comment explaining what needs to change." }, { status: 422 });

  const { error } = await supabase.rpc("return_schedule", {
    p_schedule_id: scheduleId,
    p_expected_row_version: rowVersion,
    p_comment: comment,
  });
  if (error) return scheduleErrorResponse(error, "Could not return the schedule.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
});

import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseScheduleInput } from "@/lib/schedule-input";

const invalidBody = "Date, vehicle, requests and legs are required.";

// Saves changes to a schedule's open version. rowVersion is the version
// the editor was opened on; save_schedule_draft refuses a stale save (409)
// rather than overwrite someone else's change.
export const PUT = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const body = await request.json().catch(() => null);
  const input = parseScheduleInput(body);
  const rowVersion = body?.rowVersion === null ? null : Number(body?.rowVersion);
  if (!input || (rowVersion !== null && !Number.isInteger(rowVersion))) {
    return NextResponse.json({ message: invalidBody }, { status: 422 });
  }

  const { error } = await supabase.rpc("save_schedule_draft", {
    p_schedule_id: scheduleId,
    p_expected_row_version: rowVersion,
    p_schedule_date: input.date,
    p_plate: input.plate,
    p_request_ids: input.requestIds,
    p_legs: input.legs,
  });
  if (error) return scheduleErrorResponse(error, "Could not save the draft.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
});

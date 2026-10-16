import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseScheduleInput } from "@/lib/schedule-input";
import { parseWith, rowVersionBody } from "@/lib/validation";

const invalidBody = "Requests, legs and the trip's version are required.";

// Changes a trip that's on the road, in place on its published version
// (edit_live_trip, 0060): straight to the Driver, no Admin approval. Legs
// keep their ids so the Driver's taps stay on them.
export const PUT = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const body = await readJson(request);
  const input = parseScheduleInput(body);
  const version = parseWith(rowVersionBody, body);
  if (!input || !version) {
    return NextResponse.json({ message: invalidBody }, { status: 422 });
  }

  const { error } = await supabase.rpc("edit_live_trip", {
    p_schedule_id: scheduleId,
    p_expected_row_version: version.rowVersion,
    p_request_ids: input.requestIds,
    p_legs: input.legs,
  });
  if (error) return scheduleErrorResponse(error, "Could not change the trip.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
});

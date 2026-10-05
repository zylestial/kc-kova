import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseWith, rowVersionBody } from "@/lib/validation";

// Admin approves the submitted version, publishing it. approve_schedule
// rechecks the Trip Record, the Driver, the vehicle and any pending
// cancellations, and refuses a stale version.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const body = parseWith(rowVersionBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "rowVersion is required." }, { status: 422 });

  const { error } = await supabase.rpc("approve_schedule", {
    p_schedule_id: scheduleId,
    p_expected_row_version: body.rowVersion,
  });
  if (error) return scheduleErrorResponse(error, "Could not approve the schedule.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
});

import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseWith, rowVersionBody } from "@/lib/validation";

// Sends the Scheduler's draft to Admin for approval. submit_schedule
// checks the Trip Record is complete and the draft isn't stale.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const body = parseWith(rowVersionBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "rowVersion is required." }, { status: 422 });

  const { error } = await supabase.rpc("submit_schedule", {
    p_schedule_id: scheduleId,
    p_expected_row_version: body.rowVersion,
  });
  if (error) return scheduleErrorResponse(error, "Could not submit the schedule.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
});

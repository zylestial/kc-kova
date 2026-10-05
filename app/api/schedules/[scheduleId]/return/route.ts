import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseWith, rowVersion, trimmedText } from "@/lib/validation";

const returnBody = z.object({ rowVersion, comment: trimmedText });

// Admin sends the submitted version back to the Scheduler. A comment
// saying what needs to change is required.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const body = parseWith(returnBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "rowVersion is required." }, { status: 422 });
  if (!body.comment) return NextResponse.json({ message: "Add a comment explaining what needs to change." }, { status: 422 });

  const { error } = await supabase.rpc("return_schedule", {
    p_schedule_id: scheduleId,
    p_expected_row_version: body.rowVersion,
    p_comment: body.comment,
  });
  if (error) return scheduleErrorResponse(error, "Could not return the schedule.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
});

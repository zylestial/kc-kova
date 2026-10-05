import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseWith, rowVersionBody } from "@/lib/validation";

// Throws away an unsubmitted draft: frees its reservation and returns its
// requests to Not yet scheduled, unlocked. Not a cancellation (Phase 7).
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const body = parseWith(rowVersionBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "rowVersion is required." }, { status: 422 });

  const { error } = await supabase.rpc("discard_schedule_draft", {
    p_schedule_id: scheduleId,
    p_expected_row_version: body.rowVersion,
  });
  if (error) return scheduleErrorResponse(error, "Could not discard the draft.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
});

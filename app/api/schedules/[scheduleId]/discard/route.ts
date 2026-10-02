import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";

// Throws away an unsubmitted draft: frees its reservation and returns its
// requests to Not yet scheduled, unlocked. Not a cancellation (Phase 7).
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const body = await request.json().catch(() => null);
  const rowVersion = Number(body?.rowVersion);
  if (!Number.isInteger(rowVersion)) return NextResponse.json({ message: "rowVersion is required." }, { status: 422 });

  const { error } = await supabase.rpc("discard_schedule_draft", {
    p_schedule_id: scheduleId,
    p_expected_row_version: rowVersion,
  });
  if (error) return scheduleErrorResponse(error, "Could not discard the draft.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
});

import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { loadSchedule, scheduleErrorResponse } from "@/lib/supabase/schedules";

// Admin cancels a schedule: frees its reservation and returns the requests
// it still needed to Not yet scheduled. A reason is required.
export const POST = authed<{ scheduleId: string }>(async ({ request, supabase, params: { scheduleId } }) => {
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return NextResponse.json({ message: "Add a reason for cancelling this schedule." }, { status: 422 });

  const { error } = await supabase.rpc("cancel_schedule", { p_schedule_id: scheduleId, p_reason: reason });
  if (error) return scheduleErrorResponse(error, "Could not cancel the schedule.");

  return NextResponse.json(await loadSchedule(supabase, scheduleId));
});

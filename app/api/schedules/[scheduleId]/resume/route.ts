import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// Resume trip after a Vehicle problem paused it (resume_trip, 0061).
export const POST = authed<{ scheduleId: string }>(async ({ supabase, params: { scheduleId } }) => {
  const { error } = await supabase.rpc("resume_trip", { p_schedule_id: scheduleId });
  if (error) return scheduleErrorResponse(error, "Could not resume the trip.", error.message);
  return NextResponse.json({ ok: true });
});

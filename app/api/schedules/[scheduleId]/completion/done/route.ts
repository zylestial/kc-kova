import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { toTripCompletion } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// An Admin marks a submitted completion done, which locks it for everyone.
// Repeating returns the existing done completion.
export const POST = authed<{ scheduleId: string }>(async ({ supabase, params: { scheduleId } }) => {
  const { data, error } = await supabase.rpc("mark_completion_done", { p_schedule_id: scheduleId });
  if (error) return scheduleErrorResponse(error, "Could not mark the trip as done.", error.message);

  return NextResponse.json(toTripCompletion(data));
});

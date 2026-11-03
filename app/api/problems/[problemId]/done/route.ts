import { NextResponse } from "next/server";
import { authed } from "@/lib/api-route";
import { toProblemReport } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// A report left open when the trip ended needed no planning (mark_stop_report_done,
// 0085): the Scheduler or Admin clears it, and the requests stay on the trip.
export const POST = authed<{ problemId: string }>(async ({ supabase, params: { problemId } }) => {
  const { data, error } = await supabase.rpc("mark_stop_report_done", { p_problem_id: problemId });
  if (error) return scheduleErrorResponse(error, "Could not mark it done.", error.message);

  return NextResponse.json(toProblemReport(data));
});

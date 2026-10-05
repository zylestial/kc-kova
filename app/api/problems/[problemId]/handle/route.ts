import { NextResponse } from "next/server";
import { authed, readJson } from "@/lib/api-route";
import { parseHandleProblemInput } from "@/lib/completion-input";
import { toProblemReport } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";

// An Admin marks a problem report handled, with a note and optionally the
// schedule that follows up on it. Repeating returns the handled report.
export const POST = authed<{ problemId: string }>(async ({ request, supabase, params: { problemId } }) => {
  const input = parseHandleProblemInput(await readJson(request));
  if (!input) return NextResponse.json({ message: "Describe how the problem was handled." }, { status: 422 });

  const { data, error } = await supabase.rpc("handle_problem", {
    p_problem_id: problemId,
    p_handling_note: input.handlingNote,
    p_follow_up_schedule_id: input.followUpScheduleId,
  });
  if (error) return scheduleErrorResponse(error, "Could not mark the problem as handled.", error.message);

  return NextResponse.json(toProblemReport(data));
});

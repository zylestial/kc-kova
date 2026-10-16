import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, readJson } from "@/lib/api-route";
import { toProblemReport } from "@/lib/supabase/mappers";
import { scheduleErrorResponse } from "@/lib/supabase/schedules";
import { parseWith } from "@/lib/validation";

const answerBody = z.object({ decision: z.enum(["SKIP", "WAIT", "END", "CHANGE"]) });

// A Scheduler or Admin answers a stop report the trip is held for
// (answer_stop_report, 0068): skip the stop, wait there, end the trip, or
// change the route. The Driver is told.
export const POST = authed<{ problemId: string }>(async ({ request, supabase, params: { problemId } }) => {
  const body = parseWith(answerBody, await readJson(request));
  if (!body) return NextResponse.json({ message: "Choose an answer." }, { status: 422 });

  const { data, error } = await supabase.rpc("answer_stop_report", { p_problem_id: problemId, p_decision: body.decision });
  if (error) return scheduleErrorResponse(error, "Could not send the answer.", error.message);

  return NextResponse.json(toProblemReport(data));
});
